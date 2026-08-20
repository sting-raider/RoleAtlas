use firstrung_scout::{connect_database, search};
use serde_json::json;
use uuid::Uuid;

#[tokio::test]
#[ignore = "requires a disposable PostgreSQL integration database"]
async fn search_sessions_and_feedback_are_tenant_isolated() {
    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must point to a disposable integration database");
    let pool = connect_database(&database_url).await.unwrap();
    let user_a = Uuid::new_v4();
    let user_b = Uuid::new_v4();
    let session_a = Uuid::new_v4();
    let job_id = Uuid::new_v4();

    for (id, email) in [(user_a, "a@tenant.invalid"), (user_b, "b@tenant.invalid")] {
        sqlx::query(
            "INSERT INTO roleatlas_users (id, name, email, email_verified, role) VALUES ($1,'Tenant fixture',$2,TRUE,'user')",
        )
        .bind(id)
        .bind(format!("{id}-{email}"))
        .execute(&pool)
        .await
        .unwrap();
    }
    sqlx::query(
        "INSERT INTO jobs (id, source_url, source_name, source_id, source_type, canonical_url, apply_url, identity_key, identity_strategy, title, company, description, raw) \
         VALUES ($1,$2,'Fixture','fixture:tenancy','fixture',$2,$2,$3,'fixture','Tenant Test Role','Fixture Co','Fixture description','{}')",
    )
    .bind(job_id)
    .bind(format!("https://fixture.invalid/jobs/{job_id}"))
    .bind(format!("fixture:{job_id}"))
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO search_sessions (id, user_id, status, stage, plan_snapshot) VALUES ($1,$2,'success','completed',$3)",
    )
    .bind(session_a)
    .bind(user_a)
    .bind(json!({ "roleQueries": ["Tenant Test"] }))
    .execute(&pool)
    .await
    .unwrap();

    assert!(search::is_owned(&pool, user_a, session_a).await.unwrap());
    assert!(!search::is_owned(&pool, user_b, session_a).await.unwrap());
    assert!(search::get(&pool, user_b, session_a).await.is_err());
    assert!(search::rerun(&pool, user_b, session_a).await.is_err());
    assert!(
        search::feedback(
            &pool,
            user_b,
            json!({ "session_id": session_a, "job_id": job_id, "action": "saved" }),
        )
        .await
        .is_err()
    );

    let user_b_history = search::list(&pool, user_b).await.unwrap();
    assert!(user_b_history["sessions"].as_array().unwrap().is_empty());
    search::feedback(
        &pool,
        user_a,
        json!({ "session_id": session_a, "job_id": job_id, "action": "saved" }),
    )
    .await
    .unwrap();
    let owner_id: Uuid = sqlx::query_scalar(
        "SELECT user_id FROM search_feedback WHERE session_id = $1 AND job_id = $2",
    )
    .bind(session_a)
    .bind(job_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(owner_id, user_a);

    sqlx::query("DELETE FROM roleatlas_users WHERE id = ANY($1::UUID[])")
        .bind([user_a, user_b])
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM jobs WHERE id = $1")
        .bind(job_id)
        .execute(&pool)
        .await
        .unwrap();
}

#[tokio::test]
#[ignore = "requires a disposable PostgreSQL integration database"]
async fn database_rejects_cross_tenant_parent_links_and_erases_owned_product_state() {
    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must point to a disposable integration database");
    let pool = connect_database(&database_url).await.unwrap();
    let user_a = Uuid::new_v4();
    let user_b = Uuid::new_v4();
    let profile_a = Uuid::new_v4();
    let session_a = Uuid::new_v4();

    for (id, label) in [(user_a, "integrity-a"), (user_b, "integrity-b")] {
        sqlx::query(
            "INSERT INTO roleatlas_users (id,name,email,email_verified,role) VALUES ($1,'Integrity fixture',$2,TRUE,'user')",
        )
        .bind(id)
        .bind(format!("{label}-{id}@tenant.invalid"))
        .execute(&pool)
        .await
        .unwrap();
    }
    sqlx::query(
        "INSERT INTO candidate_profiles (id,user_id,profile,source_file) VALUES ($1,$2,'{}','manual')",
    )
    .bind(profile_a)
    .bind(user_a)
    .execute(&pool)
    .await
    .unwrap();

    let cross_tenant_plan =
        sqlx::query("INSERT INTO search_plans (id,user_id,profile_id,plan) VALUES ($1,$2,$3,'{}')")
            .bind(Uuid::new_v4())
            .bind(user_b)
            .bind(profile_a)
            .execute(&pool)
            .await;
    assert!(cross_tenant_plan.is_err());

    sqlx::query(
        "INSERT INTO search_sessions (id,user_id,profile_id,status,stage,plan_snapshot) VALUES ($1,$2,$3,'success','completed','{}')",
    )
    .bind(session_a)
    .bind(user_a)
    .bind(profile_a)
    .execute(&pool)
    .await
    .unwrap();

    let application_id: Uuid = sqlx::query_scalar(
        "INSERT INTO applications (user_id,job_ref,stage) VALUES ($1,'integrity-job','Saved') RETURNING id",
    )
    .bind(user_a)
    .fetch_one(&pool)
    .await
    .unwrap();

    let cross_tenant_activity = sqlx::query(
        "INSERT INTO application_activities (application_id,id,user_id,activity_type,summary) VALUES ($1,'bad-activity',$2,'note','must fail')",
    )
    .bind(application_id)
    .bind(user_b)
    .execute(&pool)
    .await;
    assert!(cross_tenant_activity.is_err());

    let cross_tenant_artifact = sqlx::query(
        "INSERT INTO generated_application_artifacts (user_id,application_id,job_ref,artifact_type,content) VALUES ($1,$2,'integrity-job','evaluation','{}')",
    )
    .bind(user_b)
    .bind(application_id)
    .execute(&pool)
    .await;
    assert!(cross_tenant_artifact.is_err());

    sqlx::query("INSERT INTO saved_jobs (user_id,job_ref) VALUES ($1,'integrity-job')")
        .bind(user_a)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO user_provider_configurations (user_id,provider,model,base_url) VALUES ($1,'fixture','fixture-model','https://fixture.invalid/v1')",
    )
    .bind(user_a)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO ai_activity (user_id,id,action,provider,model,endpoint,started_at,completed_at,outcome) VALUES ($1,$2,'test','fixture','fixture-model','https://fixture.invalid/v1',NOW(),NOW(),'success')",
    )
    .bind(user_a)
    .bind(Uuid::new_v4())
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO generated_application_artifacts (user_id,application_id,job_ref,artifact_type,content) VALUES ($1,$2,'integrity-job','evaluation','{}')",
    )
    .bind(user_a)
    .bind(application_id)
    .execute(&pool)
    .await
    .unwrap();

    let agent_run_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO agent_runs (id,user_id,goal,max_steps,max_tool_calls,max_tokens,max_cost_micros,max_wall_time_ms,max_concurrency,deadline_at) VALUES ($1,$2,'Find a safe fixture role',10,10,1000,1000,60000,2,NOW()+INTERVAL '1 minute')",
    )
    .bind(agent_run_id)
    .bind(user_a)
    .execute(&pool)
    .await
    .unwrap();
    let cross_tenant_plan_revision = sqlx::query(
        "INSERT INTO agent_plan_revisions (user_id,run_id,version,reason,plan) VALUES ($1,$2,1,'initial','{\"version\":1,\"steps\":[]}')",
    )
    .bind(user_b)
    .bind(agent_run_id)
    .execute(&pool)
    .await;
    assert!(cross_tenant_plan_revision.is_err());

    sqlx::query("DELETE FROM roleatlas_users WHERE id=$1")
        .bind(user_a)
        .execute(&pool)
        .await
        .unwrap();

    for table in [
        "candidate_profiles",
        "search_sessions",
        "saved_jobs",
        "applications",
        "ai_activity",
        "user_provider_configurations",
        "generated_application_artifacts",
        "agent_runs",
    ] {
        let count: i64 =
            sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table} WHERE user_id=$1"))
                .bind(user_a)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 0, "{table} must be erased with its owning account");
    }

    sqlx::query("DELETE FROM roleatlas_users WHERE id=$1")
        .bind(user_b)
        .execute(&pool)
        .await
        .unwrap();
}
