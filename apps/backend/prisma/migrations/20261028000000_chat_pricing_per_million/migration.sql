-- The old CHAT prices were photons per thousand tokens. Preserve the effective
-- price while changing the unit; Prisma runs each migration only once.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "platform_models"
    WHERE "type" = 'CHAT'
      AND (jsonb_typeof("pricing"->'input') IS DISTINCT FROM 'number'
        OR jsonb_typeof("pricing"->'output') IS DISTINCT FROM 'number')
  ) THEN
    RAISE EXCEPTION 'Cannot migrate CHAT pricing: input and output must be JSON numbers';
  END IF;
END $$;

UPDATE "platform_models"
SET "pricing" = jsonb_set(
  jsonb_set("pricing", '{input}', to_jsonb(("pricing"->>'input')::numeric * 1000)),
  '{output}', to_jsonb(("pricing"->>'output')::numeric * 1000)
)
WHERE "type" = 'CHAT';
