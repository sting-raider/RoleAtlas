UPDATE jobs
SET country = 'India'
WHERE LOWER(COALESCE(location, '')) ~ '(india|bengaluru|bangalore|hyderabad|pune|mumbai|delhi|gurugram|gurgaon|noida|chennai|kolkata|ahmedabad|kochi|jaipur|chandigarh|indore|bhubaneswar)';

UPDATE jobs
SET country = 'United States'
WHERE LOWER(COALESCE(location, '')) ~ '(united states|u\.s\.|new york|san francisco|seattle|boston|austin|chicago|washington d\.c\.|los angeles)';

UPDATE jobs
SET country = 'United Kingdom'
WHERE LOWER(COALESCE(location, '')) ~ '(united kingdom|england|scotland|wales|london|manchester|edinburgh)';

UPDATE jobs SET country = 'Germany' WHERE LOWER(COALESCE(location, '')) ~ '(germany|berlin|munich|hamburg)';
UPDATE jobs SET country = 'Ireland' WHERE LOWER(COALESCE(location, '')) ~ '(ireland|dublin)';
UPDATE jobs SET country = 'Canada' WHERE LOWER(COALESCE(location, '')) ~ '(canada|toronto|vancouver|montreal)';
UPDATE jobs SET country = 'Australia' WHERE LOWER(COALESCE(location, '')) ~ '(australia|sydney|melbourne)';
UPDATE jobs SET country = 'France' WHERE LOWER(COALESCE(location, '')) ~ '(france|paris)';
UPDATE jobs SET country = 'Netherlands' WHERE LOWER(COALESCE(location, '')) ~ '(netherlands|amsterdam)';
UPDATE jobs SET country = 'Singapore' WHERE LOWER(COALESCE(location, '')) ~ 'singapore';
UPDATE jobs SET country = 'Japan' WHERE LOWER(COALESCE(location, '')) ~ '(japan|tokyo)';
