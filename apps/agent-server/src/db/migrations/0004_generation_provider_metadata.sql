ALTER TABLE generations ADD COLUMN provider_name TEXT;
ALTER TABLE generations ADD COLUMN model_name TEXT;
ALTER TABLE generations ADD COLUMN finish_reason TEXT;
ALTER TABLE generations ADD COLUMN input_chars INTEGER;
ALTER TABLE generations ADD COLUMN output_chars INTEGER;
ALTER TABLE generations ADD COLUMN input_tokens INTEGER;
ALTER TABLE generations ADD COLUMN output_tokens INTEGER;
ALTER TABLE generations ADD COLUMN error_code TEXT;
