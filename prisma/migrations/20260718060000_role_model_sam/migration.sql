-- 16-Jul role model. Base designation/role renamed Consultant → (Sales) Associate,
-- and a new Sales Assistant Manager (SAM) tier added. Renames preserve existing
-- rows (no drop/recreate); ADD VALUE is additive.
ALTER TYPE "Designation" RENAME VALUE 'Sales Consultant' TO 'Sales Associate';
ALTER TYPE "Designation" RENAME VALUE 'Assistant Sales Manager' TO 'Sales Assistant Manager';
ALTER TYPE "AppRole" RENAME VALUE 'Consultant' TO 'SalesAssociate';
ALTER TYPE "AppRole" ADD VALUE 'SalesAssistantManager';
