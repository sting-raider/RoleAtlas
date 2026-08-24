"use client";

import { LayoutDashboard } from "lucide-react";
import type { ApplicationStage } from "../jobs";

export function PipelinePanel({ applications }: { applications: Record<string, ApplicationStage> }) {
  const stages: ApplicationStage[] = ["Preparing", "Applied", "Interview", "Offer"];
  const activeCount = Object.values(applications).filter((stage) => stage !== "Closed" && stage !== "Saved").length;
  return (
    <section className="utility-card pipeline-card">
      <div className="utility-head">
        <div>
          <span className="eyebrow">Application trail</span>
          <h3>Keep momentum visible</h3>
        </div>
        <LayoutDashboard size={18} />
      </div>
      <div className="pipeline-total">
        <strong>{activeCount}</strong>
        <span>active roles</span>
      </div>
      <div className="pipeline-bar">
        <span className="bar-mint" />
        <span className="bar-lilac" />
        <span className="bar-coral" />
      </div>
      <div className="stage-list">
        {stages.map((stage) => (
          <div key={stage}>
            <span>{stage}</span>
            <strong>{Object.values(applications).filter((value) => value === stage).length}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
