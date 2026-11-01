-- Tablanathas / Cloudflare Hyperdrive
-- À exécuter UNE FOIS sur une base PostgreSQL déjà initialisée.
-- Remplace le verrou advisory du trigger par un verrou de ligne, pris en charge
-- par le pooling transactionnel Hyperdrive.

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_user_scenario_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    scenario_count integer;
BEGIN
    INSERT INTO public.user_game_settings (user_id, game_id)
    VALUES (NEW.user_id, NEW.game_id)
    ON CONFLICT (user_id, game_id) DO NOTHING;

    PERFORM 1 FROM public.user_game_settings
    WHERE user_id = NEW.user_id AND game_id = NEW.game_id
    FOR UPDATE;

    SELECT count(*) INTO scenario_count
    FROM public.user_scenarios
    WHERE user_id = NEW.user_id AND game_id = NEW.game_id;

    IF scenario_count >= 20 THEN
        RAISE EXCEPTION 'Un utilisateur ne peut pas posséder plus de 20 scénarios par partie.'
          USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

COMMIT;
