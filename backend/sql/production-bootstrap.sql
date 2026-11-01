-- Tablanathas : initialisation complète du schéma pour UNE BASE NEUVE.
-- Source : schéma de base existant + migrations de l'application actuelle.
--
-- IMPORTANT : ce script refuse de s'exécuter si des tables métier existent déjà.
-- Il ne supprime aucune donnée. Ne le relance pas à chaque déploiement.
-- Pour une base de production déjà en service, conserver les données et appliquer
-- des migrations incrémentales versionnées, jamais ce script d'initialisation.
-- Exécution : psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/sql/production-bootstrap.sql

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF to_regclass('public.games') IS NOT NULL
     OR to_regclass('public.players') IS NOT NULL
     OR to_regclass('public.player_turn_state') IS NOT NULL
     OR to_regclass('public.app_users') IS NOT NULL
     OR to_regclass('public.anathas_snapshot_runs') IS NOT NULL THEN
    RAISE EXCEPTION 'Cette base contient déjà un schéma Tablanathas. Le bootstrap est réservé à une base vide ; sauvegarde et utilise des migrations incrémentales.';
  END IF;
END $$;

BEGIN;

CREATE TABLE public.games (
  game_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  game_name text NOT NULL UNIQUE,
  current_turn integer NOT NULL DEFAULT 0 CHECK (current_turn >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.players (
  player_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_name text NOT NULL UNIQUE,
  external_player_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.player_turn_state (
  player_id bigint NOT NULL REFERENCES public.players(player_id) ON DELETE CASCADE,
  game_id bigint NOT NULL REFERENCES public.games(game_id) ON DELETE CASCADE,
  game_turn integer NOT NULL CHECK (game_turn >= 0),
  seniority_turns integer NOT NULL CHECK (seniority_turns >= 0),
  research_points numeric(12,3) NOT NULL CHECK (research_points >= 0),
  agriculture_tech numeric(12,3) NOT NULL CHECK (agriculture_tech >= 0),
  industry_tech numeric(12,3) NOT NULL CHECK (industry_tech >= 0),
  commerce_tech numeric(12,3) NOT NULL CHECK (commerce_tech >= 0),
  population bigint NOT NULL CHECK (population >= 0),
  education_primary_pct numeric(6,3) NOT NULL CHECK (education_primary_pct BETWEEN 0 AND 100),
  education_secondary_pct numeric(6,3) NOT NULL CHECK (education_secondary_pct BETWEEN 0 AND 100),
  education_higher_pct numeric(6,3) NOT NULL CHECK (education_higher_pct BETWEEN 0 AND 100),
  gms_multiplier numeric(10,4) NOT NULL,
  science_wonder_multiplier numeric(10,4) NOT NULL,
  research_funding_multiplier numeric(10,4) NOT NULL,
  gmh_multiplier numeric(10,4) NOT NULL,
  total_zones integer NOT NULL CHECK (total_zones >= 0),
  habitable_zones integer NOT NULL CHECK (habitable_zones >= 0),
  agricultural_zones integer NOT NULL CHECK (agricultural_zones >= 0),
  pollution numeric(10,4) NOT NULL,
  economic_wonder_multiplier numeric(10,4) NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, game_id, game_turn)
);

CREATE TABLE public.game_player_parameters (
  game_id bigint NOT NULL REFERENCES public.games(game_id) ON DELETE CASCADE,
  player_id bigint NOT NULL REFERENCES public.players(player_id) ON DELETE CASCADE,
  game_turn integer NOT NULL,
  budget_multiplier_200 numeric NOT NULL DEFAULT 1.00 CHECK (budget_multiplier_200 >= 0),
  agricultural_zones integer CHECK (agricultural_zones IS NULL OR agricultural_zones >= 0),
  habitable_zones integer CHECK (habitable_zones IS NULL OR habitable_zones >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, player_id, game_turn),
  CONSTRAINT fk_game_player_parameters_state
    FOREIGN KEY (player_id, game_id, game_turn)
    REFERENCES public.player_turn_state(player_id, game_id, game_turn) ON DELETE CASCADE
);

CREATE INDEX idx_player_turn_state_game_turn ON public.player_turn_state(game_id, game_turn);
CREATE INDEX idx_player_turn_state_player ON public.player_turn_state(player_id);
CREATE INDEX idx_player_turn_state_turn ON public.player_turn_state(game_turn);

CREATE OR REPLACE VIEW public.v_player_parameters AS
 SELECT s.game_id,
    s.player_id,
    s.game_turn,
    COALESCE(m.budget_multiplier_200, 1.15) AS budget_multiplier_200,
    COALESCE(m.agricultural_zones, s.agricultural_zones) AS agricultural_zones,
    COALESCE(m.habitable_zones, s.habitable_zones) AS habitable_zones,
    m.updated_at AS manual_updated_at,
    (m.player_id IS NOT NULL) AS has_manual_parameters
   FROM (public.player_turn_state s
     LEFT JOIN public.game_player_parameters m ON (((m.game_id = s.game_id) AND (m.player_id = s.player_id) AND (m.game_turn = s.game_turn))));
CREATE OR REPLACE VIEW public.v_player_dashboard AS
 WITH base AS (
         SELECT p.player_id,
            p.player_name,
            s.game_id,
            g.current_turn AS current_game_turn,
            s.game_turn,
            s.seniority_turns,
            s.research_points,
            s.agriculture_tech,
            s.industry_tech,
            s.commerce_tech,
            s.population,
            s.education_primary_pct,
            s.education_secondary_pct,
            s.education_higher_pct,
            s.gms_multiplier,
            s.science_wonder_multiplier,
            s.research_funding_multiplier,
            s.gmh_multiplier,
            s.total_zones,
            prm.habitable_zones,
            prm.agricultural_zones,
            s.pollution,
            s.economic_wonder_multiplier,
            prm.budget_multiplier_200,
            (((((s.research_points - (20)::numeric) * (5)::numeric) + (s.agriculture_tech * (10)::numeric)) + (s.industry_tech * (20)::numeric)) + (s.commerce_tech * (30)::numeric)) AS total_tech_points,
            ((5000000)::numeric + ((s.gmh_multiplier * (prm.habitable_zones)::numeric) * (18000000)::numeric)) AS population_floor,
            (0.5 + ((prm.agricultural_zones)::numeric * 0.8)) AS agriculture_revenue_multiplier,
            LEAST((((2)::numeric * s.education_secondary_pct) / (100)::numeric), 1.2) AS industry_revenue_multiplier,
            LEAST((((5)::numeric * s.education_higher_pct) / (100)::numeric), 1.75) AS commerce_revenue_multiplier,
            round(((power(GREATEST(s.research_points, (0)::numeric), (4)::numeric) * power(GREATEST((((s.agriculture_tech * (10)::numeric) + (s.industry_tech * (20)::numeric)) + (s.commerce_tech * (30)::numeric)), (0)::numeric), 0.11)) / ('195000000'::bigint)::numeric), 9) AS research_budget_estimate_billion
           FROM (((public.player_turn_state s
             JOIN public.players p ON ((p.player_id = s.player_id)))
             JOIN public.games g ON ((g.game_id = s.game_id)))
             LEFT JOIN public.v_player_parameters prm ON (((prm.player_id = s.player_id) AND (prm.game_id = s.game_id) AND (prm.game_turn = s.game_turn))))
        ), tech AS (
         SELECT b.player_id,
            b.player_name,
            b.game_id,
            b.current_game_turn,
            b.game_turn,
            b.seniority_turns,
            b.research_points,
            b.agriculture_tech,
            b.industry_tech,
            b.commerce_tech,
            b.population,
            b.education_primary_pct,
            b.education_secondary_pct,
            b.education_higher_pct,
            b.gms_multiplier,
            b.science_wonder_multiplier,
            b.research_funding_multiplier,
            b.gmh_multiplier,
            b.total_zones,
            b.habitable_zones,
            b.agricultural_zones,
            b.pollution,
            b.economic_wonder_multiplier,
            b.budget_multiplier_200,
            b.total_tech_points,
            b.population_floor,
            b.agriculture_revenue_multiplier,
            b.industry_revenue_multiplier,
            b.commerce_revenue_multiplier,
            b.research_budget_estimate_billion,
            round((b.total_tech_points / (NULLIF(b.seniority_turns, 0))::numeric), 1) AS tech_profitability,
            ((round(((b.gms_multiplier * (b.education_primary_pct / (100)::numeric)) * ((1)::numeric + (power((b.population)::numeric, 0.4) / (120)::numeric)))) + round(((b.gms_multiplier * (b.education_secondary_pct / (100)::numeric)) * ((5)::numeric + (power((b.population)::numeric, 0.5) / (230)::numeric))))) + round(((b.gms_multiplier * (b.education_higher_pct / (100)::numeric)) * ((10)::numeric + (power((b.population)::numeric, 0.7) / (2050)::numeric))))) AS education_cost
           FROM base b
        ), tech2 AS (
         SELECT t.player_id,
            t.player_name,
            t.game_id,
            t.current_game_turn,
            t.game_turn,
            t.seniority_turns,
            t.research_points,
            t.agriculture_tech,
            t.industry_tech,
            t.commerce_tech,
            t.population,
            t.education_primary_pct,
            t.education_secondary_pct,
            t.education_higher_pct,
            t.gms_multiplier,
            t.science_wonder_multiplier,
            t.research_funding_multiplier,
            t.gmh_multiplier,
            t.total_zones,
            t.habitable_zones,
            t.agricultural_zones,
            t.pollution,
            t.economic_wonder_multiplier,
            t.budget_multiplier_200,
            t.total_tech_points,
            t.population_floor,
            t.agriculture_revenue_multiplier,
            t.industry_revenue_multiplier,
            t.commerce_revenue_multiplier,
            t.research_budget_estimate_billion,
            t.tech_profitability,
            t.education_cost,
            (((t.research_points * t.science_wonder_multiplier) * t.budget_multiplier_200) - t.education_cost) AS next_turn_tech_production,
            round(((t.total_tech_points + (((t.research_points * t.science_wonder_multiplier) * t.budget_multiplier_200) - t.education_cost)) / ((t.seniority_turns + 1))::numeric), 1) AS projected_profitability,
            ((1)::numeric - (t.pollution * 0.2)) AS agriculture_pollution_penalty,
            ((100)::numeric + (t.agriculture_tech * (6)::numeric)) AS agriculture_gross_per_capita,
            ((110)::numeric + ((35)::numeric * t.industry_tech)) AS industry_gross_per_capita,
            ((40)::numeric + ((30)::numeric * t.commerce_tech)) AS commerce_gross_per_capita
           FROM tech t
        ), economy AS (
         SELECT t2.player_id,
            t2.player_name,
            t2.game_id,
            t2.current_game_turn,
            t2.game_turn,
            t2.seniority_turns,
            t2.research_points,
            t2.agriculture_tech,
            t2.industry_tech,
            t2.commerce_tech,
            t2.population,
            t2.education_primary_pct,
            t2.education_secondary_pct,
            t2.education_higher_pct,
            t2.gms_multiplier,
            t2.science_wonder_multiplier,
            t2.research_funding_multiplier,
            t2.gmh_multiplier,
            t2.total_zones,
            t2.habitable_zones,
            t2.agricultural_zones,
            t2.pollution,
            t2.economic_wonder_multiplier,
            t2.budget_multiplier_200,
            t2.total_tech_points,
            t2.population_floor,
            t2.agriculture_revenue_multiplier,
            t2.industry_revenue_multiplier,
            t2.commerce_revenue_multiplier,
            t2.research_budget_estimate_billion,
            t2.tech_profitability,
            t2.education_cost,
            t2.next_turn_tech_production,
            t2.projected_profitability,
            t2.agriculture_pollution_penalty,
            t2.agriculture_gross_per_capita,
            t2.industry_gross_per_capita,
            t2.commerce_gross_per_capita,
            round((((t2.agriculture_pollution_penalty * t2.agriculture_gross_per_capita) * t2.agriculture_revenue_multiplier) * t2.economic_wonder_multiplier)) AS agriculture_net_per_capita,
            round(((t2.industry_gross_per_capita * t2.industry_revenue_multiplier) * t2.economic_wonder_multiplier)) AS industry_net_per_capita,
            round(((t2.commerce_gross_per_capita * t2.commerce_revenue_multiplier) * t2.economic_wonder_multiplier)) AS commerce_net_per_capita
           FROM tech2 t2
        ), economy2 AS (
         SELECT e.player_id,
            e.player_name,
            e.game_id,
            e.current_game_turn,
            e.game_turn,
            e.seniority_turns,
            e.research_points,
            e.agriculture_tech,
            e.industry_tech,
            e.commerce_tech,
            e.population,
            e.education_primary_pct,
            e.education_secondary_pct,
            e.education_higher_pct,
            e.gms_multiplier,
            e.science_wonder_multiplier,
            e.research_funding_multiplier,
            e.gmh_multiplier,
            e.total_zones,
            e.habitable_zones,
            e.agricultural_zones,
            e.pollution,
            e.economic_wonder_multiplier,
            e.budget_multiplier_200,
            e.total_tech_points,
            e.population_floor,
            e.agriculture_revenue_multiplier,
            e.industry_revenue_multiplier,
            e.commerce_revenue_multiplier,
            e.research_budget_estimate_billion,
            e.tech_profitability,
            e.education_cost,
            e.next_turn_tech_production,
            e.projected_profitability,
            e.agriculture_pollution_penalty,
            e.agriculture_gross_per_capita,
            e.industry_gross_per_capita,
            e.commerce_gross_per_capita,
            e.agriculture_net_per_capita,
            e.industry_net_per_capita,
            e.commerce_net_per_capita,
            round((((0.8 * (e.population)::numeric) * e.agriculture_net_per_capita) / (1000000000)::numeric), 1) AS agriculture_scenario_billion,
            round((((e.industry_net_per_capita * (e.population)::numeric) * 0.5) / (1000000000)::numeric), 1) AS industry_scenario_billion,
            round((((e.commerce_net_per_capita * (e.population)::numeric) * 0.6) / (1000000000)::numeric), 1) AS commerce_scenario_billion
           FROM economy e
        ), economy3 AS (
         SELECT e2.player_id,
            e2.player_name,
            e2.game_id,
            e2.current_game_turn,
            e2.game_turn,
            e2.seniority_turns,
            e2.research_points,
            e2.agriculture_tech,
            e2.industry_tech,
            e2.commerce_tech,
            e2.population,
            e2.education_primary_pct,
            e2.education_secondary_pct,
            e2.education_higher_pct,
            e2.gms_multiplier,
            e2.science_wonder_multiplier,
            e2.research_funding_multiplier,
            e2.gmh_multiplier,
            e2.total_zones,
            e2.habitable_zones,
            e2.agricultural_zones,
            e2.pollution,
            e2.economic_wonder_multiplier,
            e2.budget_multiplier_200,
            e2.total_tech_points,
            e2.population_floor,
            e2.agriculture_revenue_multiplier,
            e2.industry_revenue_multiplier,
            e2.commerce_revenue_multiplier,
            e2.research_budget_estimate_billion,
            e2.tech_profitability,
            e2.education_cost,
            e2.next_turn_tech_production,
            e2.projected_profitability,
            e2.agriculture_pollution_penalty,
            e2.agriculture_gross_per_capita,
            e2.industry_gross_per_capita,
            e2.commerce_gross_per_capita,
            e2.agriculture_net_per_capita,
            e2.industry_net_per_capita,
            e2.commerce_net_per_capita,
            e2.agriculture_scenario_billion,
            e2.industry_scenario_billion,
            e2.commerce_scenario_billion,
            round(((e2.agriculture_scenario_billion * 0.5) + (e2.industry_scenario_billion * 0.5)), 1) AS mixed_agriculture_industry_scenario_billion,
            NULL::numeric AS mixed_commerce_industry_scenario_billion,
            NULL::numeric AS military_mixed_scenario_billion
           FROM economy2 e2
        ), economy4 AS (
         SELECT e3.player_id,
            e3.player_name,
            e3.game_id,
            e3.current_game_turn,
            e3.game_turn,
            e3.seniority_turns,
            e3.research_points,
            e3.agriculture_tech,
            e3.industry_tech,
            e3.commerce_tech,
            e3.population,
            e3.education_primary_pct,
            e3.education_secondary_pct,
            e3.education_higher_pct,
            e3.gms_multiplier,
            e3.science_wonder_multiplier,
            e3.research_funding_multiplier,
            e3.gmh_multiplier,
            e3.total_zones,
            e3.habitable_zones,
            e3.agricultural_zones,
            e3.pollution,
            e3.economic_wonder_multiplier,
            e3.budget_multiplier_200,
            e3.total_tech_points,
            e3.population_floor,
            e3.agriculture_revenue_multiplier,
            e3.industry_revenue_multiplier,
            e3.commerce_revenue_multiplier,
            e3.research_budget_estimate_billion,
            e3.tech_profitability,
            e3.education_cost,
            e3.next_turn_tech_production,
            e3.projected_profitability,
            e3.agriculture_pollution_penalty,
            e3.agriculture_gross_per_capita,
            e3.industry_gross_per_capita,
            e3.commerce_gross_per_capita,
            e3.agriculture_net_per_capita,
            e3.industry_net_per_capita,
            e3.commerce_net_per_capita,
            e3.agriculture_scenario_billion,
            e3.industry_scenario_billion,
            e3.commerce_scenario_billion,
            e3.mixed_agriculture_industry_scenario_billion,
            e3.mixed_commerce_industry_scenario_billion,
            e3.military_mixed_scenario_billion,
            GREATEST(e3.commerce_scenario_billion, e3.mixed_agriculture_industry_scenario_billion, e3.industry_scenario_billion, e3.agriculture_scenario_billion) AS max_economic_potential_billion,
            ((e3.population)::numeric + ((e3.population_floor - (e3.population)::numeric) * 0.2)) AS population_after_20pct_floor_move
           FROM economy3 e3
        ), projection AS (
         SELECT e4.player_id,
            e4.player_name,
            e4.game_id,
            e4.current_game_turn,
            e4.game_turn,
            e4.seniority_turns,
            e4.research_points,
            e4.agriculture_tech,
            e4.industry_tech,
            e4.commerce_tech,
            e4.population,
            e4.education_primary_pct,
            e4.education_secondary_pct,
            e4.education_higher_pct,
            e4.gms_multiplier,
            e4.science_wonder_multiplier,
            e4.research_funding_multiplier,
            e4.gmh_multiplier,
            e4.total_zones,
            e4.habitable_zones,
            e4.agricultural_zones,
            e4.pollution,
            e4.economic_wonder_multiplier,
            e4.budget_multiplier_200,
            e4.total_tech_points,
            e4.population_floor,
            e4.agriculture_revenue_multiplier,
            e4.industry_revenue_multiplier,
            e4.commerce_revenue_multiplier,
            e4.research_budget_estimate_billion,
            e4.tech_profitability,
            e4.education_cost,
            e4.next_turn_tech_production,
            e4.projected_profitability,
            e4.agriculture_pollution_penalty,
            e4.agriculture_gross_per_capita,
            e4.industry_gross_per_capita,
            e4.commerce_gross_per_capita,
            e4.agriculture_net_per_capita,
            e4.industry_net_per_capita,
            e4.commerce_net_per_capita,
            e4.agriculture_scenario_billion,
            e4.industry_scenario_billion,
            e4.commerce_scenario_billion,
            e4.mixed_agriculture_industry_scenario_billion,
            e4.mixed_commerce_industry_scenario_billion,
            e4.military_mixed_scenario_billion,
            e4.max_economic_potential_billion,
            e4.population_after_20pct_floor_move,
            ((round(((e4.gms_multiplier * (e4.education_primary_pct / (100)::numeric)) * ((1)::numeric + (power(e4.population_after_20pct_floor_move, 0.4) / (120)::numeric)))) + round(((e4.gms_multiplier * (e4.education_secondary_pct / (100)::numeric)) * ((5)::numeric + (power(e4.population_after_20pct_floor_move, 0.5) / (230)::numeric))))) + round(((e4.gms_multiplier * (e4.education_higher_pct / (100)::numeric)) * ((10)::numeric + (power(e4.population_after_20pct_floor_move, 0.7) / (2050)::numeric))))) AS projected_education_cost
           FROM economy4 e4
        ), calculated AS (
         SELECT p.player_id,
            p.player_name,
            p.game_id,
            p.current_game_turn,
            p.game_turn,
            p.seniority_turns,
            p.research_points,
            p.agriculture_tech,
            p.industry_tech,
            p.commerce_tech,
            p.population,
            p.education_primary_pct,
            p.education_secondary_pct,
            p.education_higher_pct,
            p.gms_multiplier,
            p.science_wonder_multiplier,
            p.research_funding_multiplier,
            p.gmh_multiplier,
            p.total_zones,
            p.habitable_zones,
            p.agricultural_zones,
            p.pollution,
            p.economic_wonder_multiplier,
            p.budget_multiplier_200,
            p.total_tech_points,
            p.population_floor,
            p.agriculture_revenue_multiplier,
            p.industry_revenue_multiplier,
            p.commerce_revenue_multiplier,
            p.research_budget_estimate_billion,
            p.tech_profitability,
            p.education_cost,
            p.next_turn_tech_production,
            p.projected_profitability,
            p.agriculture_pollution_penalty,
            p.agriculture_gross_per_capita,
            p.industry_gross_per_capita,
            p.commerce_gross_per_capita,
            p.agriculture_net_per_capita,
            p.industry_net_per_capita,
            p.commerce_net_per_capita,
            p.agriculture_scenario_billion,
            p.industry_scenario_billion,
            p.commerce_scenario_billion,
            p.mixed_agriculture_industry_scenario_billion,
            p.mixed_commerce_industry_scenario_billion,
            p.military_mixed_scenario_billion,
            p.max_economic_potential_billion,
            p.population_after_20pct_floor_move,
            p.projected_education_cost,
            round(((p.total_tech_points + ((((((((p.research_points * p.science_wonder_multiplier) * p.budget_multiplier_200) - p.projected_education_cost) * CASE WHEN COALESCE(p.research_budget_estimate_billion, (0)::numeric) > (0)::numeric AND COALESCE(p.max_economic_potential_billion, (0)::numeric) >= (0)::numeric AND p.population > (0)::numeric THEN sqrt((GREATEST(COALESCE(p.max_economic_potential_billion, (0)::numeric), (0)::numeric) / p.research_budget_estimate_billion)) ELSE NULL::numeric END) * ((p.population)::numeric + ((p.population_floor - (p.population)::numeric) * 0.4))) / (NULLIF(p.population, 0))::numeric) * 0.5) * (10)::numeric)) / ((p.seniority_turns + 10))::numeric), 1) AS profitability_10_turns
           FROM projection p
        ), ranked AS (
         SELECT c.player_id,
            c.player_name,
            c.game_id,
            c.current_game_turn,
            c.game_turn,
            c.seniority_turns,
            c.research_points,
            c.agriculture_tech,
            c.industry_tech,
            c.commerce_tech,
            c.population,
            c.education_primary_pct,
            c.education_secondary_pct,
            c.education_higher_pct,
            c.gms_multiplier,
            c.science_wonder_multiplier,
            c.research_funding_multiplier,
            c.gmh_multiplier,
            c.total_zones,
            c.habitable_zones,
            c.agricultural_zones,
            c.pollution,
            c.economic_wonder_multiplier,
            c.budget_multiplier_200,
            c.total_tech_points,
            c.population_floor,
            c.agriculture_revenue_multiplier,
            c.industry_revenue_multiplier,
            c.commerce_revenue_multiplier,
            c.research_budget_estimate_billion,
            c.tech_profitability,
            c.education_cost,
            c.next_turn_tech_production,
            c.projected_profitability,
            c.agriculture_pollution_penalty,
            c.agriculture_gross_per_capita,
            c.industry_gross_per_capita,
            c.commerce_gross_per_capita,
            c.agriculture_net_per_capita,
            c.industry_net_per_capita,
            c.commerce_net_per_capita,
            c.agriculture_scenario_billion,
            c.industry_scenario_billion,
            c.commerce_scenario_billion,
            c.mixed_agriculture_industry_scenario_billion,
            c.mixed_commerce_industry_scenario_billion,
            c.military_mixed_scenario_billion,
            c.max_economic_potential_billion,
            c.population_after_20pct_floor_move,
            c.projected_education_cost,
            c.profitability_10_turns,
            rank() OVER (PARTITION BY c.game_id, c.game_turn ORDER BY c.tech_profitability DESC) AS profitability_rank,
            rank() OVER (PARTITION BY c.game_id, c.game_turn ORDER BY c.projected_profitability DESC) AS projected_profitability_rank,
            CASE WHEN c.profitability_10_turns IS NULL THEN NULL ELSE rank() OVER (PARTITION BY c.game_id, c.game_turn ORDER BY c.profitability_10_turns DESC NULLS LAST) END AS profitability_10_turn_rank,
            rank() OVER (PARTITION BY c.game_id, c.game_turn ORDER BY c.max_economic_potential_billion DESC) AS economic_potential_rank
           FROM calculated c
        ), with_best_scenario AS (
         SELECT r.player_id,
            r.player_name,
            r.game_id,
            r.current_game_turn,
            r.game_turn,
            r.seniority_turns,
            r.research_points,
            r.agriculture_tech,
            r.industry_tech,
            r.commerce_tech,
            r.population,
            r.education_primary_pct,
            r.education_secondary_pct,
            r.education_higher_pct,
            r.gms_multiplier,
            r.science_wonder_multiplier,
            r.research_funding_multiplier,
            r.gmh_multiplier,
            r.total_zones,
            r.habitable_zones,
            r.agricultural_zones,
            r.pollution,
            r.economic_wonder_multiplier,
            r.budget_multiplier_200,
            r.total_tech_points,
            r.population_floor,
            r.agriculture_revenue_multiplier,
            r.industry_revenue_multiplier,
            r.commerce_revenue_multiplier,
            r.research_budget_estimate_billion,
            r.tech_profitability,
            r.education_cost,
            r.next_turn_tech_production,
            r.projected_profitability,
            r.agriculture_pollution_penalty,
            r.agriculture_gross_per_capita,
            r.industry_gross_per_capita,
            r.commerce_gross_per_capita,
            r.agriculture_net_per_capita,
            r.industry_net_per_capita,
            r.commerce_net_per_capita,
            r.agriculture_scenario_billion,
            r.industry_scenario_billion,
            r.commerce_scenario_billion,
            r.mixed_agriculture_industry_scenario_billion,
            r.mixed_commerce_industry_scenario_billion,
            r.military_mixed_scenario_billion,
            r.max_economic_potential_billion,
            r.population_after_20pct_floor_move,
            r.projected_education_cost,
            r.profitability_10_turns,
            r.profitability_rank,
            r.projected_profitability_rank,
            r.profitability_10_turn_rank,
            r.economic_potential_rank,
                CASE
                    WHEN (r.commerce_scenario_billion = r.max_economic_potential_billion) THEN 'Commerce'::text
                    WHEN (r.mixed_agriculture_industry_scenario_billion = r.max_economic_potential_billion) THEN 'Agro-industrie (Agriculture + Industrie)'::text
                    WHEN (r.industry_scenario_billion = r.max_economic_potential_billion) THEN 'Industrie'::text
                    WHEN (r.agriculture_scenario_billion = r.max_economic_potential_billion) THEN 'Agriculture'::text
                    ELSE NULL::text
                END AS economic_best_scenario
           FROM ranked r
        )
 SELECT player_id,
    player_name,
    game_id,
    game_turn,
    current_game_turn,
    seniority_turns,
    budget_multiplier_200,
    research_points,
    agriculture_tech,
    industry_tech,
    commerce_tech,
    total_tech_points,
    tech_profitability,
    population,
    education_primary_pct,
    education_secondary_pct,
    education_higher_pct,
    gms_multiplier,
    education_cost,
    science_wonder_multiplier,
    research_funding_multiplier,
    next_turn_tech_production,
    projected_profitability,
    profitability_rank,
    projected_profitability_rank,
    gmh_multiplier,
    profitability_10_turns,
    profitability_10_turn_rank,
    total_zones,
    habitable_zones,
    population_floor,
    agricultural_zones,
    agriculture_revenue_multiplier,
    industry_revenue_multiplier,
    commerce_revenue_multiplier,
    research_budget_estimate_billion,
    pollution,
    economic_wonder_multiplier,
    agriculture_pollution_penalty,
    agriculture_gross_per_capita,
    agriculture_net_per_capita,
    agriculture_scenario_billion,
    industry_gross_per_capita,
    industry_net_per_capita,
    industry_scenario_billion,
    mixed_agriculture_industry_scenario_billion,
    commerce_gross_per_capita,
    commerce_net_per_capita,
    commerce_scenario_billion,
    mixed_commerce_industry_scenario_billion,
    military_mixed_scenario_billion,
    economic_best_scenario,
    max_economic_potential_billion,
    economic_potential_rank
   FROM with_best_scenario;
CREATE OR REPLACE VIEW public.v_current_turn_dashboard AS
 SELECT d.player_id,
    d.player_name,
    d.game_id,
    d.game_turn,
    d.current_game_turn,
    d.seniority_turns,
    d.budget_multiplier_200,
    d.research_points,
    d.agriculture_tech,
    d.industry_tech,
    d.commerce_tech,
    d.total_tech_points,
    d.tech_profitability,
    d.population,
    d.education_primary_pct,
    d.education_secondary_pct,
    d.education_higher_pct,
    d.gms_multiplier,
    d.education_cost,
    d.science_wonder_multiplier,
    d.research_funding_multiplier,
    d.next_turn_tech_production,
    d.projected_profitability,
    d.profitability_rank,
    d.projected_profitability_rank,
    d.gmh_multiplier,
    d.profitability_10_turns,
    d.profitability_10_turn_rank,
    d.total_zones,
    d.habitable_zones,
    d.population_floor,
    d.agricultural_zones,
    d.agriculture_revenue_multiplier,
    d.industry_revenue_multiplier,
    d.commerce_revenue_multiplier,
    d.research_budget_estimate_billion,
    d.pollution,
    d.economic_wonder_multiplier,
    d.agriculture_pollution_penalty,
    d.agriculture_gross_per_capita,
    d.agriculture_net_per_capita,
    d.agriculture_scenario_billion,
    d.industry_gross_per_capita,
    d.industry_net_per_capita,
    d.industry_scenario_billion,
    d.mixed_agriculture_industry_scenario_billion,
    d.commerce_gross_per_capita,
    d.commerce_net_per_capita,
    d.commerce_scenario_billion,
    d.mixed_commerce_industry_scenario_billion,
    d.military_mixed_scenario_billion,
    d.economic_best_scenario,
    d.max_economic_potential_billion,
    d.economic_potential_rank
   FROM (public.v_player_dashboard d
     JOIN public.games g ON ((g.game_id = d.game_id)))
  WHERE (d.game_turn = g.current_turn);
CREATE OR REPLACE VIEW public.v_economic_ranking AS
 SELECT game_id,
    game_turn,
    player_id,
    player_name,
    population,
    pollution,
    agriculture_net_per_capita,
    agriculture_scenario_billion,
    industry_net_per_capita,
    industry_scenario_billion,
    mixed_agriculture_industry_scenario_billion,
    commerce_net_per_capita,
    commerce_scenario_billion,
    mixed_commerce_industry_scenario_billion,
    military_mixed_scenario_billion,
    economic_best_scenario,
    max_economic_potential_billion,
    economic_potential_rank
   FROM public.v_player_dashboard;
CREATE OR REPLACE VIEW public.v_manual_player_parameters AS
 SELECT p.game_id,
    p.game_turn,
    p.player_id,
    pl.player_name,
    p.budget_multiplier_200,
    p.agricultural_zones,
    p.habitable_zones,
    p.has_manual_parameters,
    p.manual_updated_at
   FROM (public.v_player_parameters p
     JOIN public.players pl ON ((pl.player_id = p.player_id)));
CREATE OR REPLACE VIEW public.v_player_history AS
 SELECT game_id,
    game_turn,
    player_id,
    player_name,
    seniority_turns,
    research_points,
    agriculture_tech,
    industry_tech,
    commerce_tech,
    total_tech_points,
    tech_profitability,
    next_turn_tech_production,
    projected_profitability,
    profitability_10_turns,
    population,
    population_floor,
    education_primary_pct,
    education_secondary_pct,
    education_higher_pct,
    pollution,
    max_economic_potential_billion,
    economic_potential_rank,
    profitability_rank,
    projected_profitability_rank,
    profitability_10_turn_rank
   FROM public.v_player_dashboard;
CREATE OR REPLACE VIEW public.v_tech_ranking AS
 SELECT game_id,
    game_turn,
    player_id,
    player_name,
    seniority_turns,
    research_points,
    total_tech_points,
    tech_profitability,
    profitability_rank,
    next_turn_tech_production,
    projected_profitability,
    projected_profitability_rank,
    profitability_10_turns,
    profitability_10_turn_rank
   FROM public.v_player_dashboard;

-- Initialise la seule partie cible. Les joueurs et historiques seront alimentés par les captures Anathas.
INSERT INTO public.games(game_name, current_turn) VALUES ('Anathas', 0);

-- ===== 002_multiuser =====
-- Tablanathas - migration additive vers une architecture multi-utilisateur
-- Cible : schema PostgreSQL public existant du dump fourni.
-- Cette migration ajoute des tables et une relation de membership.
-- Elle ne supprime ni ne modifie les vues de calcul existantes.
-- A executer une seule fois, sur une sauvegarde de la base.

-- 1. Comptes applicatifs. L'authentification (hachage et validation du mot de passe)
-- reste a implementer dans l'API ; ne jamais stocker un mot de passe en clair.
CREATE TABLE public.app_users (
    user_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username text NOT NULL,
    email text,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT app_users_username_nonempty CHECK (btrim(username) <> ''),
    CONSTRAINT app_users_password_hash_nonempty CHECK (btrim(password_hash) <> '')
);

-- Insensibles a la casse : Alice et alice ne peuvent pas etre deux comptes differents.
CREATE UNIQUE INDEX ux_app_users_username_ci ON public.app_users (lower(username));
CREATE UNIQUE INDEX ux_app_users_email_ci ON public.app_users (lower(email));

-- 2. Membership explicite : un joueur peut participer a une ou plusieurs parties.
-- On reconstruit les memberships existants a partir des snapshots deja enregistres.
CREATE TABLE public.game_players (
    game_id bigint NOT NULL,
    player_id bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT game_players_pkey PRIMARY KEY (game_id, player_id),
    CONSTRAINT game_players_game_fkey
        FOREIGN KEY (game_id) REFERENCES public.games(game_id) ON DELETE CASCADE,
    CONSTRAINT game_players_player_fkey
        FOREIGN KEY (player_id) REFERENCES public.players(player_id) ON DELETE CASCADE
);

INSERT INTO public.game_players (game_id, player_id)
SELECT DISTINCT s.game_id, s.player_id
FROM public.player_turn_state AS s
ON CONFLICT (game_id, player_id) DO NOTHING;

-- Empêche désormais l'enregistrement d'un snapshot pour un joueur qui n'est pas
-- membre de la partie concernée. Les FK existantes restent en place.
ALTER TABLE public.player_turn_state
    ADD CONSTRAINT player_turn_state_game_player_fkey
    FOREIGN KEY (game_id, player_id)
    REFERENCES public.game_players (game_id, player_id)
    ON DELETE CASCADE;

CREATE INDEX idx_game_players_player ON public.game_players (player_id, game_id);

-- 3. Joueurs que chaque utilisateur choisit d'afficher dans son dashboard.
CREATE TABLE public.user_tracked_players (
    user_id bigint NOT NULL,
    game_id bigint NOT NULL,
    player_id bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_tracked_players_pkey
        PRIMARY KEY (user_id, game_id, player_id),
    CONSTRAINT user_tracked_players_user_fkey
        FOREIGN KEY (user_id) REFERENCES public.app_users(user_id) ON DELETE CASCADE,
    CONSTRAINT user_tracked_players_game_player_fkey
        FOREIGN KEY (game_id, player_id)
        REFERENCES public.game_players(game_id, player_id) ON DELETE CASCADE
);

CREATE INDEX idx_user_tracked_players_game
    ON public.user_tracked_players (user_id, game_id);

-- 4. Scenarios prives. Un scenario appartient a un utilisateur et a une partie.
-- Le scenario par defaut sert de base personnelle ; les autres peuvent representer
-- des variantes strategiques independantes.
CREATE TABLE public.user_scenarios (
    scenario_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL,
    game_id bigint NOT NULL,
    scenario_name text NOT NULL,
    description text,
    is_default boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_scenarios_name_nonempty
        CHECK (btrim(scenario_name) <> ''),
    CONSTRAINT user_scenarios_user_fkey
        FOREIGN KEY (user_id) REFERENCES public.app_users(user_id) ON DELETE CASCADE,
    CONSTRAINT user_scenarios_game_fkey
        FOREIGN KEY (game_id) REFERENCES public.games(game_id) ON DELETE CASCADE,
    -- Cle unique composite pour que les overrides ne puissent pas pointer vers
    -- un scenario d'une autre partie.
    CONSTRAINT user_scenarios_scenario_game_key UNIQUE (scenario_id, game_id)
);

CREATE UNIQUE INDEX ux_user_scenarios_name_ci
    ON public.user_scenarios (user_id, game_id, lower(scenario_name));

CREATE UNIQUE INDEX ux_user_scenarios_one_default
    ON public.user_scenarios (user_id, game_id)
    WHERE is_default;

CREATE INDEX idx_user_scenarios_user_game
    ON public.user_scenarios (user_id, game_id);

-- 5. Parametres des coefficients economiques actuellement en dur dans
-- v_player_dashboard. Les valeurs par defaut reprennent les coefficients existants.
-- Un trigger cree automatiquement une ligne de parametres par scenario, avec ces valeurs.
CREATE TABLE public.user_scenario_economic_parameters (
    scenario_id bigint PRIMARY KEY,

    agriculture_population_coefficient numeric(8,5) NOT NULL DEFAULT 0.42105,
    industry_population_coefficient numeric(8,5) NOT NULL DEFAULT 0.26316,
    commerce_population_coefficient numeric(8,5) NOT NULL DEFAULT 0.31579,

    mixed_agriculture_industry_agriculture_weight numeric(8,5) NOT NULL DEFAULT 0.50000,
    mixed_agriculture_industry_industry_weight numeric(8,5) NOT NULL DEFAULT 0.50000,

    mixed_commerce_industry_industry_weight numeric(8,5) NOT NULL DEFAULT 0.50000,
    mixed_commerce_industry_commerce_weight numeric(8,5) NOT NULL DEFAULT 0.50000,

    military_industry_coefficient numeric(8,5) NOT NULL DEFAULT 0.05000,
    military_commerce_coefficient numeric(8,5) NOT NULL DEFAULT 0.60000,

    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_scenario_economic_parameters_scenario_fkey
        FOREIGN KEY (scenario_id)
        REFERENCES public.user_scenarios(scenario_id) ON DELETE CASCADE,

    CONSTRAINT chk_usep_agriculture_population
        CHECK (agriculture_population_coefficient BETWEEN 0 AND 1),
    CONSTRAINT chk_usep_industry_population
        CHECK (industry_population_coefficient BETWEEN 0 AND 1),
    CONSTRAINT chk_usep_commerce_population
        CHECK (commerce_population_coefficient BETWEEN 0 AND 1),
    CONSTRAINT chk_usep_population_allocation_total
        CHECK (agriculture_population_coefficient + industry_population_coefficient + commerce_population_coefficient = 1.00000),
    CONSTRAINT chk_usep_mixed_agri_weight
        CHECK (mixed_agriculture_industry_agriculture_weight BETWEEN 0 AND 1),
    CONSTRAINT chk_usep_mixed_industry_weight
        CHECK (mixed_agriculture_industry_industry_weight BETWEEN 0 AND 1),
    CONSTRAINT chk_usep_mixed_commerce_industry_weight
        CHECK (mixed_commerce_industry_industry_weight BETWEEN 0 AND 1),
    CONSTRAINT chk_usep_mixed_commerce_weight
        CHECK (mixed_commerce_industry_commerce_weight BETWEEN 0 AND 1),
    CONSTRAINT chk_usep_military_industry
        CHECK (military_industry_coefficient BETWEEN 0 AND 1),
    CONSTRAINT chk_usep_military_commerce
        CHECK (military_commerce_coefficient BETWEEN 0 AND 1)
);

CREATE FUNCTION public.init_user_scenario_economic_parameters()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO public.user_scenario_economic_parameters (scenario_id)
    VALUES (NEW.scenario_id);
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_user_scenarios_init_economic_parameters
AFTER INSERT ON public.user_scenarios
FOR EACH ROW
EXECUTE FUNCTION public.init_user_scenario_economic_parameters();

-- 6. Hypotheses de donnees par scenario, joueur et snapshot de reference.
-- Une colonne NULL signifie : reprendre la valeur officielle/calcul de reference.
-- base_game_turn identifie explicitement le snapshot a partir duquel l'hypothese
-- est formulee. Elle ne represente pas le tour futur projete.
CREATE TABLE public.user_scenario_player_overrides (
    scenario_id bigint NOT NULL,
    game_id bigint NOT NULL,
    player_id bigint NOT NULL,
    base_game_turn integer NOT NULL,

    seniority_turns integer,
    research_points numeric(12,3),
    agriculture_tech numeric(12,3),
    industry_tech numeric(12,3),
    commerce_tech numeric(12,3),
    population bigint,
    education_primary_pct numeric(6,3),
    education_secondary_pct numeric(6,3),
    education_higher_pct numeric(6,3),
    gms_multiplier numeric(10,4),
    science_wonder_multiplier numeric(10,4),
    research_funding_multiplier numeric(10,4),
    gmh_multiplier numeric(10,4),
    total_zones integer,
    habitable_zones integer,
    agricultural_zones integer,
    pollution numeric(10,4),
    economic_wonder_multiplier numeric(10,4),

    -- Ces trois champs existent dans la couche de parametres manuels actuelle.
    budget_multiplier_200 numeric(10,4),

    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT user_scenario_player_overrides_pkey
        PRIMARY KEY (scenario_id, game_id, player_id, base_game_turn),
    CONSTRAINT user_scenario_player_overrides_scenario_game_fkey
        FOREIGN KEY (scenario_id, game_id)
        REFERENCES public.user_scenarios(scenario_id, game_id) ON DELETE CASCADE,
    CONSTRAINT user_scenario_player_overrides_membership_fkey
        FOREIGN KEY (game_id, player_id)
        REFERENCES public.game_players(game_id, player_id) ON DELETE CASCADE,
    CONSTRAINT user_scenario_player_overrides_base_snapshot_fkey
        FOREIGN KEY (player_id, game_id, base_game_turn)
        REFERENCES public.player_turn_state(player_id, game_id, game_turn) ON DELETE CASCADE,

    CONSTRAINT chk_uspo_seniority_nonnegative
        CHECK (seniority_turns IS NULL OR seniority_turns >= 0),
    CONSTRAINT chk_uspo_research_nonnegative
        CHECK (research_points IS NULL OR research_points >= 0),
    CONSTRAINT chk_uspo_agriculture_tech_nonnegative
        CHECK (agriculture_tech IS NULL OR agriculture_tech >= 0),
    CONSTRAINT chk_uspo_industry_tech_nonnegative
        CHECK (industry_tech IS NULL OR industry_tech >= 0),
    CONSTRAINT chk_uspo_commerce_tech_nonnegative
        CHECK (commerce_tech IS NULL OR commerce_tech >= 0),
    CONSTRAINT chk_uspo_population_nonnegative
        CHECK (population IS NULL OR population >= 0),
    CONSTRAINT chk_uspo_education_primary_range
        CHECK (education_primary_pct IS NULL OR education_primary_pct BETWEEN 0 AND 100),
    CONSTRAINT chk_uspo_education_secondary_range
        CHECK (education_secondary_pct IS NULL OR education_secondary_pct BETWEEN 0 AND 100),
    CONSTRAINT chk_uspo_education_higher_range
        CHECK (education_higher_pct IS NULL OR education_higher_pct BETWEEN 0 AND 100),
    CONSTRAINT chk_uspo_gms_nonnegative
        CHECK (gms_multiplier IS NULL OR gms_multiplier >= 0),
    CONSTRAINT chk_uspo_science_wonder_nonnegative
        CHECK (science_wonder_multiplier IS NULL OR science_wonder_multiplier >= 0),
    CONSTRAINT chk_uspo_research_funding_nonnegative
        CHECK (research_funding_multiplier IS NULL OR research_funding_multiplier >= 0),
    CONSTRAINT chk_uspo_gmh_nonnegative
        CHECK (gmh_multiplier IS NULL OR gmh_multiplier >= 0),
    CONSTRAINT chk_uspo_total_zones_nonnegative
        CHECK (total_zones IS NULL OR total_zones >= 0),
    CONSTRAINT chk_uspo_habitable_zones_nonnegative
        CHECK (habitable_zones IS NULL OR habitable_zones >= 0),
    CONSTRAINT chk_uspo_agricultural_zones_nonnegative
        CHECK (agricultural_zones IS NULL OR agricultural_zones >= 0),
    CONSTRAINT chk_uspo_pollution_nonnegative
        CHECK (pollution IS NULL OR pollution >= 0),
    CONSTRAINT chk_uspo_economic_wonder_nonnegative
        CHECK (economic_wonder_multiplier IS NULL OR economic_wonder_multiplier >= 0),
    CONSTRAINT chk_uspo_budget_multiplier_nonnegative
        CHECK (budget_multiplier_200 IS NULL OR budget_multiplier_200 >= 0),
    CONSTRAINT chk_uspo_at_least_one_override CHECK (
        num_nonnulls(
            seniority_turns, research_points, agriculture_tech, industry_tech,
            commerce_tech, population, education_primary_pct, education_secondary_pct,
            education_higher_pct, gms_multiplier, science_wonder_multiplier,
            research_funding_multiplier, gmh_multiplier, total_zones, habitable_zones,
            agricultural_zones, pollution, economic_wonder_multiplier,
            budget_multiplier_200
        ) > 0
    )
);

CREATE INDEX idx_user_scenario_overrides_lookup
    ON public.user_scenario_player_overrides
       (scenario_id, game_id, base_game_turn, player_id);

-- IMPORTANT : les vues existantes (v_player_dashboard, v_current_turn_dashboard,
-- v_tech_ranking et v_economic_ranking) continuent de representer le calcul partage.
-- Elles ne deviennent PAS personnalisees par cette migration.
-- Le trigger cree automatiquement les coefficients economiques d'un nouveau scenario.
-- La prochaine etape sera d'adapter l'API/le moteur de calcul pour prendre en entree
-- un user_id + scenario_id, appliquer les overrides a la copie des valeurs officielles,
-- puis recalculer les indicateurs et les classements du scenario sans modifier les snapshots.


-- ===== 003_anathas_snapshots =====
-- Tablanathas — historique de captures Anathas et alimentation du dashboard.
-- À exécuter une seule fois sur la base existante, avant le déploiement du nouveau backend.
-- La clé API Anathas reste uniquement dans l'environnement du serveur.

-- Migration depuis l'ancienne table miroir (une ligne par pays) : on la conserve en archive.
DO $$
BEGIN
  IF to_regclass('public.anathas_country_snapshots') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'anathas_country_snapshots'
         AND column_name = 'snapshot_id'
     ) THEN
    IF to_regclass('public.anathas_country_snapshots_legacy') IS NULL THEN
      ALTER TABLE public.anathas_country_snapshots RENAME TO anathas_country_snapshots_legacy;
    ELSE
      RAISE EXCEPTION 'anathas_country_snapshots_legacy existe déjà ; vérifie les anciennes tables avant migration';
    END IF;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.anathas_game_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  current_game_turn integer NOT NULL DEFAULT 0 CHECK (current_game_turn >= 0),
  game_id bigint REFERENCES public.games(game_id) ON DELETE SET NULL,
  initialized boolean NOT NULL DEFAULT false,
  initialized_from text,
  last_turn_start_key text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.anathas_game_state(singleton, current_game_turn, initialized)
VALUES (true, 0, false)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.anathas_snapshot_runs (
  snapshot_id bigserial PRIMARY KEY,
  schedule_key text NOT NULL UNIQUE,
  scheduled_local_at text NOT NULL,
  scheduled_for timestamptz NOT NULL,
  snapshot_phase text NOT NULL CHECK (snapshot_phase IN ('start', 'end')),
  game_turn integer CHECK (game_turn >= 0),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  expected_country_count integer NOT NULL DEFAULT 0 CHECK (expected_country_count >= 0),
  captured_country_count integer NOT NULL DEFAULT 0 CHECK (captured_country_count >= 0),
  details_failed_count integer NOT NULL DEFAULT 0 CHECK (details_failed_count >= 0),
  failures jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_message text,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  retry_after timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_anathas_snapshot_runs_turn
  ON public.anathas_snapshot_runs(game_turn, scheduled_for DESC);
CREATE INDEX IF NOT EXISTS idx_anathas_snapshot_runs_status
  ON public.anathas_snapshot_runs(status, scheduled_for DESC);

CREATE TABLE IF NOT EXISTS public.anathas_country_snapshots (
  snapshot_id bigint NOT NULL REFERENCES public.anathas_snapshot_runs(snapshot_id) ON DELETE CASCADE,
  country_id bigint NOT NULL,
  player_id bigint REFERENCES public.players(player_id) ON DELETE SET NULL,
  country_name text NOT NULL,
  ruler_name text,
  particule text,
  rank integer,
  score numeric,
  registered_timestamp numeric,
  seniority_cycles numeric,
  population numeric,
  happiness numeric,
  land_size numeric,
  habitable_regions numeric,
  total_zones integer NOT NULL DEFAULT 0 CHECK (total_zones >= 0),
  habitable_zones integer NOT NULL DEFAULT 0 CHECK (habitable_zones >= 0),
  agricultural_zones integer NOT NULL DEFAULT 0 CHECK (agricultural_zones >= 0),
  pollution numeric,
  carbon_credits numeric,
  agriculture_tech numeric,
  industry_tech numeric,
  commerce_tech numeric,
  research_points numeric,
  education_primary_ratio numeric,
  education_secondary_ratio numeric,
  education_higher_ratio numeric,
  education_primary_pct numeric,
  education_secondary_pct numeric,
  education_higher_pct numeric,
  alliance_id text,
  alliance_name text,
  alliance_status text,
  alliance_game_id text,
  wonder_type text,
  wonder_score numeric,
  gms_multiplier numeric(10,4) NOT NULL DEFAULT 1,
  science_wonder_multiplier numeric(10,4) NOT NULL DEFAULT 1,
  gmh_multiplier numeric(10,4) NOT NULL DEFAULT 1,
  economic_wonder_multiplier numeric(10,4) NOT NULL DEFAULT 1,
  research_funding_multiplier numeric(10,4) NOT NULL DEFAULT 1,
  research_budget_estimate_billion numeric,
  military_status text,
  military_victories numeric,
  military_defeats numeric,
  is_on_vacation boolean,
  vacation_until text,
  description text,
  raw_ranking jsonb NOT NULL,
  raw_details jsonb,
  captured_at timestamptz NOT NULL DEFAULT now(),
  details_synced_at timestamptz,
  PRIMARY KEY (snapshot_id, country_id)
);
CREATE INDEX IF NOT EXISTS idx_anathas_snapshots_country_history
  ON public.anathas_country_snapshots(country_id, snapshot_id DESC);
CREATE INDEX IF NOT EXISTS idx_anathas_snapshots_player_history
  ON public.anathas_country_snapshots(player_id, snapshot_id DESC);
CREATE INDEX IF NOT EXISTS idx_anathas_snapshots_rank
  ON public.anathas_country_snapshots(snapshot_id, rank, country_name);

-- Le budget estimé est conservé sur l'état du tour pour pouvoir rester stable entre les deux captures.
ALTER TABLE public.player_turn_state
  ADD COLUMN IF NOT EXISTS research_budget_estimate_billion numeric;

-- Ajuste l'expression de base de la vue existante sans en changer les colonnes :
-- le budget estimé stocké au début du tour prime sur le calcul dynamique historique.
-- Les CTE et métriques dépendantes de ce budget réutilisent alors la valeur conservée.
DO $$
DECLARE
  view_definition text;
  adjusted_definition text;
BEGIN
  IF to_regclass('public.v_player_dashboard') IS NOT NULL THEN
    SELECT pg_get_viewdef('public.v_player_dashboard'::regclass, true)
      INTO view_definition;
    adjusted_definition := regexp_replace(
      view_definition,
      '(round\(.*?\)) AS research_budget_estimate_billion',
      'COALESCE(NULLIF(s.research_budget_estimate_billion, 0), \1) AS research_budget_estimate_billion',
      's'
    );
    IF adjusted_definition = view_definition THEN
      RAISE EXCEPTION 'Impossible de mettre à jour automatiquement v_player_dashboard : expression research_budget_estimate_billion non reconnue.';
    END IF;
    EXECUTE 'CREATE OR REPLACE VIEW public.v_player_dashboard AS ' || adjusted_definition;
  END IF;
END $$;

-- ===== 004_extended_player_turn_state =====
-- Tablanathas — extension ciblée de player_turn_state pour les calculs futurs.
-- À exécuter APRÈS tablanathas_anathas_migration.sql, sur une sauvegarde de la base.
-- Les données détaillées d'affichage restent conservées dans anathas_country_snapshots.
-- Cette migration ajoute uniquement les champs utiles aux futurs calculs qui ne sont pas
-- déjà présents dans player_turn_state. Elle est réexécutable.

ALTER TABLE public.player_turn_state
  ADD COLUMN IF NOT EXISTS rank integer,
  ADD COLUMN IF NOT EXISTS score numeric,
  ADD COLUMN IF NOT EXISTS happiness numeric,
  ADD COLUMN IF NOT EXISTS land_size numeric,
  ADD COLUMN IF NOT EXISTS habitable_regions numeric,
  ADD COLUMN IF NOT EXISTS carbon_credits numeric,
  ADD COLUMN IF NOT EXISTS education_primary_ratio numeric,
  ADD COLUMN IF NOT EXISTS education_secondary_ratio numeric,
  ADD COLUMN IF NOT EXISTS education_higher_ratio numeric,
  ADD COLUMN IF NOT EXISTS wonder_type text,
  ADD COLUMN IF NOT EXISTS wonder_score numeric,
  ADD COLUMN IF NOT EXISTS military_status text,
  ADD COLUMN IF NOT EXISTS military_victories numeric,
  ADD COLUMN IF NOT EXISTS military_defeats numeric;

COMMENT ON COLUMN public.player_turn_state.rank IS 'Rang Anathas au moment de la capture du tour.';
COMMENT ON COLUMN public.player_turn_state.score IS 'Score brut Anathas, conservé en NUMERIC pour préserver les grandes valeurs.';
COMMENT ON COLUMN public.player_turn_state.happiness IS 'Bonheur brut renvoyé par Anathas.';
COMMENT ON COLUMN public.player_turn_state.land_size IS 'Superficie du territoire renvoyée par Anathas.';
COMMENT ON COLUMN public.player_turn_state.habitable_regions IS 'Nombre de régions habitables renvoyé par Anathas; distinct de total_zones.';
COMMENT ON COLUMN public.player_turn_state.carbon_credits IS 'Crédits carbone renvoyés par Anathas.';
COMMENT ON COLUMN public.player_turn_state.education_primary_ratio IS 'Ratio primaire brut de l’API (ex. 1 = 100 %), sans conversion en pourcentage.';
COMMENT ON COLUMN public.player_turn_state.education_secondary_ratio IS 'Ratio secondaire brut de l’API (ex. 1 = 100 %), sans conversion en pourcentage.';
COMMENT ON COLUMN public.player_turn_state.education_higher_ratio IS 'Ratio supérieur brut de l’API (ex. 0.4 = 40 %), sans conversion en pourcentage.';
COMMENT ON COLUMN public.player_turn_state.wonder_type IS 'Type brut de merveille Anathas.';
COMMENT ON COLUMN public.player_turn_state.wonder_score IS 'Score/taille de merveille renvoyé par Anathas.';
COMMENT ON COLUMN public.player_turn_state.military_status IS 'Statut militaire brut renvoyé par Anathas.';
COMMENT ON COLUMN public.player_turn_state.military_victories IS 'Nombre de victoires militaires renvoyé par Anathas.';
COMMENT ON COLUMN public.player_turn_state.military_defeats IS 'Nombre de défaites militaires renvoyé par Anathas.';

-- Récupère les valeurs historiques déjà enregistrées dans les snapshots, si disponibles.
-- On ne remplace jamais une valeur qui aurait déjà été renseignée dans les nouvelles colonnes.
WITH latest_country AS (
  SELECT DISTINCT ON (c.player_id, r.game_turn)
    c.player_id,
    r.game_turn,
    c.rank,
    c.score,
    c.happiness,
    c.land_size,
    c.habitable_regions,
    c.carbon_credits,
    c.education_primary_ratio,
    c.education_secondary_ratio,
    c.education_higher_ratio,
    c.wonder_type,
    c.wonder_score,
    c.military_status,
    c.military_victories,
    c.military_defeats
  FROM public.anathas_country_snapshots AS c
  JOIN public.anathas_snapshot_runs AS r
    ON r.snapshot_id = c.snapshot_id
  WHERE c.player_id IS NOT NULL
    AND r.game_turn IS NOT NULL
    AND r.status = 'completed'
    AND c.player_id IS NOT NULL
    AND c.snapshot_id IS NOT NULL
    AND c.country_id IS NOT NULL
  ORDER BY c.player_id, r.game_turn, c.captured_at DESC, c.snapshot_id DESC
)
UPDATE public.player_turn_state AS s
SET rank = COALESCE(s.rank, c.rank),
    score = COALESCE(s.score, c.score),
    happiness = COALESCE(s.happiness, c.happiness),
    land_size = COALESCE(s.land_size, c.land_size),
    habitable_regions = COALESCE(s.habitable_regions, c.habitable_regions),
    carbon_credits = COALESCE(s.carbon_credits, c.carbon_credits),
    education_primary_ratio = COALESCE(s.education_primary_ratio, c.education_primary_ratio),
    education_secondary_ratio = COALESCE(s.education_secondary_ratio, c.education_secondary_ratio),
    education_higher_ratio = COALESCE(s.education_higher_ratio, c.education_higher_ratio),
    wonder_type = COALESCE(s.wonder_type, c.wonder_type),
    wonder_score = COALESCE(s.wonder_score, c.wonder_score),
    military_status = COALESCE(s.military_status, c.military_status),
    military_victories = COALESCE(s.military_victories, c.military_victories),
    military_defeats = COALESCE(s.military_defeats, c.military_defeats)
FROM latest_country AS c
WHERE s.player_id = c.player_id
  AND s.game_turn = c.game_turn
  AND s.game_id = COALESCE(
    (SELECT gs.game_id FROM public.anathas_game_state AS gs WHERE gs.singleton = true),
    s.game_id
  );

-- ===== 005_user_settings_and_scenario_limits =====
-- Tablanathas: paramètres par défaut personnels et garde-fous pour Config/Détails.
-- À exécuter après tablanathas_multiuser_migration.sql et tablanathas_anathas_migration.sql.
-- Migration additive/réexécutable ; aucune donnée de capture n'est supprimée.

CREATE TABLE IF NOT EXISTS public.user_game_settings (
    user_id bigint NOT NULL REFERENCES public.app_users(user_id) ON DELETE CASCADE,
    game_id bigint NOT NULL REFERENCES public.games(game_id) ON DELETE CASCADE,
    default_agricultural_zones integer NOT NULL DEFAULT 0 CHECK (default_agricultural_zones >= 0),
    default_habitable_zones integer NOT NULL DEFAULT 0 CHECK (default_habitable_zones >= 0),
    default_budget_multiplier_200 numeric(10,4) NOT NULL DEFAULT 2.0 CHECK (default_budget_multiplier_200 >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_user_game_settings_game
    ON public.user_game_settings(game_id, user_id);

-- Un verrou transactionnel par utilisateur/partie protège la limite de 20 scénarios
-- même si deux requêtes de création arrivent simultanément.
CREATE OR REPLACE FUNCTION public.enforce_user_scenario_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    scenario_count integer;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text || ':' || NEW.game_id::text, 0));
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

DROP TRIGGER IF EXISTS trg_user_scenarios_limit ON public.user_scenarios;
CREATE TRIGGER trg_user_scenarios_limit
BEFORE INSERT ON public.user_scenarios
FOR EACH ROW
EXECUTE FUNCTION public.enforce_user_scenario_limit();

COMMENT ON TABLE public.user_game_settings IS
  'Hypothèses personnelles par défaut, distinctes des valeurs brutes Anathas et des captures partagées.';
COMMENT ON COLUMN public.user_game_settings.default_agricultural_zones IS
  'Hypothèse personnelle utilisée en l’absence d’une surcharge par joueur et par tour.';
COMMENT ON COLUMN public.user_game_settings.default_habitable_zones IS
  'Hypothèse personnelle utilisée en l’absence d’une surcharge par joueur et par tour.';
COMMENT ON COLUMN public.user_game_settings.default_budget_multiplier_200 IS
  'Champ numérique historique conservé pour compatibilité ; le modèle actif utilise default_budget_200_enabled comme source de vérité.';

-- ===== 006_budget_toggle =====
-- Tablanathas — correction du financement à 200 % et modèle de score/Tech sup.
-- À exécuter après tablanathas_ui_features_migration.sql et tablanathas_extend_player_turn_state.sql.
-- Migration additive et réexécutable. Les scores restent NUMERIC pour conserver leur précision.

-- Le financement à 200 % est un indicateur, pas un multiplicateur de 2.
-- TRUE => multiplicateur de productivité 1.15 ; FALSE => 1.0.
ALTER TABLE public.user_game_settings
  ADD COLUMN IF NOT EXISTS default_budget_200_enabled boolean;

ALTER TABLE public.user_scenario_player_overrides
  ADD COLUMN IF NOT EXISTS budget_200_enabled boolean;

-- Préserve les anciens réglages par défaut lorsqu'ils stockaient explicitement
-- 2.0 (financement x2) ou 1.15 (ancien multiplicateur de productivité activé).
-- En cas de valeur différente, le financement reste désactivé par défaut.
UPDATE public.user_game_settings
SET default_budget_200_enabled = CASE
  WHEN default_budget_multiplier_200 IN (2.0, 1.15) THEN true
  ELSE false
END
WHERE default_budget_200_enabled IS NULL
   OR (default_budget_200_enabled = false AND default_budget_multiplier_200 IN (2.0, 1.15));

ALTER TABLE public.user_game_settings
  ALTER COLUMN default_budget_200_enabled SET DEFAULT false;

-- Convertit d'anciennes valeurs de surcharge explicites vers le nouveau booléen.
-- 2.0 était l'ancienne représentation du financement à 200 % dans l'interface ;
-- 1.15 était la représentation du multiplicateur de productivité ; 1.0 = inactif.
UPDATE public.user_scenario_player_overrides
SET budget_200_enabled = CASE
  WHEN budget_multiplier_200 IN (2.0, 1.15) THEN true
  ELSE false
END
WHERE budget_200_enabled IS NULL;

-- Met le champ de compatibilité à la valeur de productivité réellement appliquée.
-- On démarre les réglages par défaut sur FALSE : les utilisateurs pourront ensuite l'activer.
UPDATE public.user_game_settings
SET default_budget_multiplier_200 = CASE WHEN default_budget_200_enabled THEN 1.15 ELSE 1.0 END;

UPDATE public.user_scenario_player_overrides
SET budget_multiplier_200 = CASE WHEN budget_200_enabled THEN 1.15 ELSE 1.0 END;

ALTER TABLE public.user_game_settings
  ALTER COLUMN default_budget_200_enabled SET NOT NULL;

COMMENT ON COLUMN public.user_game_settings.default_budget_200_enabled IS
  'Indicateur : TRUE active le multiplicateur de productivité x1.15, FALSE applique x1.';
COMMENT ON COLUMN public.user_scenario_player_overrides.budget_200_enabled IS
  'Surcharge par scénario/joueur/tour : TRUE applique x1.15 à la productivité, FALSE applique x1.';
COMMENT ON COLUMN public.user_scenario_player_overrides.budget_multiplier_200 IS
  'Compatibilité avec l’ancien modèle : valeur dérivée 1.15 si activé, sinon 1.0.';

-- ===== 007_economic_hypotheses =====
-- Tablanathas: hypothèses économiques privées + scénario économique personnalisé.
-- À exécuter après tablanathas_ui_features_migration.sql,
-- tablanathas_score_and_budget_toggle_migration.sql et les migrations historiques.
-- Migration additive/réexécutable : n'écrase pas les hypothèses personnelles existantes.

-- Hypothèses personnelles par défaut (Config).
ALTER TABLE public.user_game_settings
    ADD COLUMN IF NOT EXISTS default_industrial_zones integer NOT NULL DEFAULT 0 CHECK (default_industrial_zones >= 0),
    ADD COLUMN IF NOT EXISTS default_commercial_zones integer NOT NULL DEFAULT 0 CHECK (default_commercial_zones >= 0),
    ADD COLUMN IF NOT EXISTS default_dense_residential_zones_enabled boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS default_social_integration_pact_enabled boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS default_reduced_holidays_enabled boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS default_forest_exploitation_enabled boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS default_industrial_zone_housing_enabled boolean NOT NULL DEFAULT false;

-- Les UPDATE protègent aussi les éventuelles colonnes préexistantes contenant des NULL.
UPDATE public.user_game_settings
SET default_industrial_zones = COALESCE(default_industrial_zones, 0),
    default_commercial_zones = COALESCE(default_commercial_zones, 0),
    default_dense_residential_zones_enabled = COALESCE(default_dense_residential_zones_enabled, true),
    default_social_integration_pact_enabled = COALESCE(default_social_integration_pact_enabled, false),
    default_reduced_holidays_enabled = COALESCE(default_reduced_holidays_enabled, false),
    default_forest_exploitation_enabled = COALESCE(default_forest_exploitation_enabled, false),
    default_industrial_zone_housing_enabled = COALESCE(default_industrial_zone_housing_enabled, false);

ALTER TABLE public.user_game_settings
    ALTER COLUMN default_industrial_zones SET DEFAULT 0,
    ALTER COLUMN default_industrial_zones SET NOT NULL,
    ALTER COLUMN default_commercial_zones SET DEFAULT 0,
    ALTER COLUMN default_commercial_zones SET NOT NULL,
    ALTER COLUMN default_dense_residential_zones_enabled SET DEFAULT true,
    ALTER COLUMN default_dense_residential_zones_enabled SET NOT NULL,
    ALTER COLUMN default_social_integration_pact_enabled SET DEFAULT false,
    ALTER COLUMN default_social_integration_pact_enabled SET NOT NULL,
    ALTER COLUMN default_reduced_holidays_enabled SET DEFAULT false,
    ALTER COLUMN default_reduced_holidays_enabled SET NOT NULL,
    ALTER COLUMN default_forest_exploitation_enabled SET DEFAULT false,
    ALTER COLUMN default_forest_exploitation_enabled SET NOT NULL,
    ALTER COLUMN default_industrial_zone_housing_enabled SET DEFAULT false,
    ALTER COLUMN default_industrial_zone_housing_enabled SET NOT NULL;

-- Surcharges par scénario/joueur/tour. NULL signifie « reprendre la préférence par défaut ».
ALTER TABLE public.user_scenario_player_overrides
    ADD COLUMN IF NOT EXISTS industrial_zones integer CHECK (industrial_zones IS NULL OR industrial_zones >= 0),
    ADD COLUMN IF NOT EXISTS commercial_zones integer CHECK (commercial_zones IS NULL OR commercial_zones >= 0),
    ADD COLUMN IF NOT EXISTS dense_residential_zones_enabled boolean,
    ADD COLUMN IF NOT EXISTS social_integration_pact_enabled boolean,
    ADD COLUMN IF NOT EXISTS reduced_holidays_enabled boolean,
    ADD COLUMN IF NOT EXISTS forest_exploitation_enabled boolean,
    ADD COLUMN IF NOT EXISTS industrial_zone_housing_enabled boolean;

-- Scénario interne additionnel (au-delà des six calculs de base).
ALTER TABLE public.user_scenario_economic_parameters
    ADD COLUMN IF NOT EXISTS custom_scenario_enabled boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS custom_scenario_name text NOT NULL DEFAULT 'Scénario personnalisé' CHECK (btrim(custom_scenario_name) <> ''),
    ADD COLUMN IF NOT EXISTS custom_agriculture_weight numeric(8,5) NOT NULL DEFAULT 0.33 CHECK (custom_agriculture_weight BETWEEN 0 AND 1),
    ADD COLUMN IF NOT EXISTS custom_industry_weight numeric(8,5) NOT NULL DEFAULT 0.33 CHECK (custom_industry_weight BETWEEN 0 AND 1),
    ADD COLUMN IF NOT EXISTS custom_commerce_weight numeric(8,5) NOT NULL DEFAULT 0.33 CHECK (custom_commerce_weight BETWEEN 0 AND 1);

UPDATE public.user_scenario_economic_parameters
SET custom_scenario_enabled = COALESCE(custom_scenario_enabled, false),
    custom_scenario_name = COALESCE(NULLIF(btrim(custom_scenario_name), ''), 'Scénario personnalisé'),
    custom_agriculture_weight = COALESCE(custom_agriculture_weight, 0.33),
    custom_industry_weight = COALESCE(custom_industry_weight, 0.33),
    custom_commerce_weight = COALESCE(custom_commerce_weight, 0.33);

ALTER TABLE public.user_scenario_economic_parameters
    ALTER COLUMN custom_scenario_enabled SET DEFAULT false,
    ALTER COLUMN custom_scenario_name SET DEFAULT 'Scénario personnalisé',
    ALTER COLUMN custom_scenario_name SET NOT NULL,
    ALTER COLUMN custom_scenario_enabled SET NOT NULL,
    ALTER COLUMN custom_agriculture_weight SET DEFAULT 0.33,
    ALTER COLUMN custom_agriculture_weight SET NOT NULL,
    ALTER COLUMN custom_industry_weight SET DEFAULT 0.33,
    ALTER COLUMN custom_industry_weight SET NOT NULL,
    ALTER COLUMN custom_commerce_weight SET DEFAULT 0.33,
    ALTER COLUMN custom_commerce_weight SET NOT NULL;

COMMENT ON COLUMN public.user_game_settings.default_dense_residential_zones_enabled IS
    'Hypothèse personnelle : multiplie par 1.2 la capacité résidentielle produite par les zones habitables, sans multiplier les 5 millions de base.';
COMMENT ON COLUMN public.user_game_settings.default_social_integration_pact_enabled IS
    'Hypothèse personnelle : second multiplicateur x1.2 sur la capacité résidentielle hors base de 5 millions.';
COMMENT ON COLUMN public.user_game_settings.default_reduced_holidays_enabled IS
    'Hypothèse personnelle : multiplie par 1.3 les revenus bruts industriels et commerciaux (effet conservé sur le net calculé).';
COMMENT ON COLUMN public.user_game_settings.default_forest_exploitation_enabled IS
    'Hypothèse personnelle : multiplie par 1.4 le revenu agricole brut avant calcul du revenu agricole net.';
COMMENT ON COLUMN public.user_game_settings.default_industrial_zone_housing_enabled IS
    'Hypothèse personnelle : multiplie par 1.4 la capacité productive ajoutée par les zones industrielles, au-delà de la base de 20 millions.';
COMMENT ON COLUMN public.user_scenario_economic_parameters.custom_scenario_enabled IS
    'Ajoute le scénario composite personnalisé au maximum de potentiel économique, en plus des six calculs prédéfinis.';

-- ===== 008_zone_percentages =====
-- Tablanathas: répartition des zones par pourcentage + règle de capacité totale.
-- À exécuter après tablanathas_economic_hypotheses_custom_scenario_migration.sql.
-- Les anciens champs default_*_zones (comptes fixes) sont conservés pour compatibilité
-- mais ne sont plus utilisés par Config : leurs valeurs ne peuvent pas être converties
-- fidèlement en pourcentages sans connaître la taille de chaque pays.

ALTER TABLE public.user_game_settings
  ADD COLUMN IF NOT EXISTS default_habitable_zones_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (default_habitable_zones_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS default_agricultural_zones_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (default_agricultural_zones_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS default_industrial_zones_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (default_industrial_zones_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS default_commercial_zones_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (default_commercial_zones_pct BETWEEN 0 AND 100);

UPDATE public.user_game_settings
SET default_habitable_zones_pct = COALESCE(default_habitable_zones_pct, 0),
    default_agricultural_zones_pct = COALESCE(default_agricultural_zones_pct, 0),
    default_industrial_zones_pct = COALESCE(default_industrial_zones_pct, 0),
    default_commercial_zones_pct = COALESCE(default_commercial_zones_pct, 0);

ALTER TABLE public.user_game_settings
  ALTER COLUMN default_habitable_zones_pct SET DEFAULT 0,
  ALTER COLUMN default_habitable_zones_pct SET NOT NULL,
  ALTER COLUMN default_agricultural_zones_pct SET DEFAULT 0,
  ALTER COLUMN default_agricultural_zones_pct SET NOT NULL,
  ALTER COLUMN default_industrial_zones_pct SET DEFAULT 0,
  ALTER COLUMN default_industrial_zones_pct SET NOT NULL,
  ALTER COLUMN default_commercial_zones_pct SET DEFAULT 0,
  ALTER COLUMN default_commercial_zones_pct SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_game_settings'::regclass
      AND conname = 'user_game_settings_default_zone_pct_sum_check'
  ) THEN
    ALTER TABLE public.user_game_settings
      ADD CONSTRAINT user_game_settings_default_zone_pct_sum_check CHECK (
        default_habitable_zones_pct
        + default_agricultural_zones_pct
        + default_industrial_zones_pct
        + default_commercial_zones_pct <= 100.00
      );
  END IF;
END $$;

COMMENT ON COLUMN public.user_game_settings.default_habitable_zones_pct IS
  'Part du total de zones de chaque pays attribuée aux zones résidentielles/habitables; arrondie au plus proche avec plafonnement au total disponible.';
COMMENT ON COLUMN public.user_game_settings.default_dense_residential_zones_enabled IS
  'Ajoute +20 % à la capacité résidentielle fournie par les zones habitables, hors des 5 000 000 de base.';
COMMENT ON COLUMN public.user_game_settings.default_social_integration_pact_enabled IS
  'Ajoute séparément +20 % à la capacité résidentielle hors base; avec Zones résidentielles denses, le bonus total est +40 %, pas +44 %.';
COMMENT ON COLUMN public.user_scenario_player_overrides.dense_residential_zones_enabled IS
  'Surcharge par joueur/tour : ajoute +20 % à la capacité résidentielle hors des 5 000 000 de base.';
COMMENT ON COLUMN public.user_scenario_player_overrides.social_integration_pact_enabled IS
  'Surcharge par joueur/tour : ajoute séparément +20 % à la capacité résidentielle hors base; les deux bonus sont additifs.';
COMMENT ON COLUMN public.user_game_settings.default_agricultural_zones_pct IS
  'Part du total de zones de chaque pays attribuée aux zones agricoles.';
COMMENT ON COLUMN public.user_game_settings.default_industrial_zones_pct IS
  'Part du total de zones de chaque pays attribuée aux zones industrielles.';
COMMENT ON COLUMN public.user_game_settings.default_commercial_zones_pct IS
  'Part du total de zones de chaque pays attribuée aux zones commerciales.';

-- ===== 009_roles =====
-- Rôles applicatifs pour Tablanathas. À exécuter après tablanathas_multiuser_migration.sql.
-- Migration additive et réexécutable. Le compte existant dont l'identifiant est
-- exactement « admin » (sans distinction de casse) est promu administrateur.

ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS role text;

UPDATE public.app_users SET role = 'user' WHERE role IS NULL;
ALTER TABLE public.app_users ALTER COLUMN role SET DEFAULT 'user';
ALTER TABLE public.app_users ALTER COLUMN role SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'app_users_role_check'
      AND conrelid = 'public.app_users'::regclass
  ) THEN
    ALTER TABLE public.app_users
      ADD CONSTRAINT app_users_role_check CHECK (role IN ('user', 'admin'));
  END IF;
END $$;

UPDATE public.app_users
SET role = 'admin', updated_at = now()
WHERE lower(username) = 'admin' AND role <> 'admin';

COMMENT ON COLUMN public.app_users.role IS
  'Rôle applicatif : user ou admin. Les routes administrateur vérifient ce rôle côté serveur.';

-- Session store. Express also uses createTableIfMissing, but we create it during bootstrap
-- so schema creation is explicit and auditable.
CREATE TABLE public.user_sessions (
  sid varchar NOT NULL PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX "IDX_user_sessions_expire" ON public.user_sessions(expire);

-- Aligne la nouvelle base sur les défauts de Config actuellement livrés.
UPDATE public.user_game_settings
SET default_habitable_zones_pct = 40,
    default_agricultural_zones_pct = 10,
    default_industrial_zones_pct = 20,
    default_commercial_zones_pct = 30,
    updated_at = now();
ALTER TABLE public.user_game_settings
  ALTER COLUMN default_habitable_zones_pct SET DEFAULT 40,
  ALTER COLUMN default_agricultural_zones_pct SET DEFAULT 10,
  ALTER COLUMN default_industrial_zones_pct SET DEFAULT 20,
  ALTER COLUMN default_commercial_zones_pct SET DEFAULT 30;
-- Le dump réel conserve DEFAULT 2.0 pour cette ancienne colonne de compatibilité.
-- Le calcul actif s'appuie sur default_budget_200_enabled ; l'API synchronise
-- default_budget_multiplier_200 à 1.0 ou 1.15 lorsqu'un réglage est enregistré.
ALTER TABLE public.user_game_settings
  ALTER COLUMN default_budget_multiplier_200 SET DEFAULT 2.0;

UPDATE public.anathas_game_state
SET game_id = (SELECT game_id FROM public.games WHERE game_name = 'Anathas' ORDER BY game_id LIMIT 1),
    updated_at = now()
WHERE singleton = true AND game_id IS NULL;

CREATE TABLE public.schema_migrations (
  migration_id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.schema_migrations(migration_id) VALUES
  ('001_core_schema'),
  ('002_multiuser'),
  ('003_anathas_snapshots'),
  ('004_extended_player_turn_state'),
  ('005_user_settings_and_scenario_limits'),
  ('006_budget_toggle'),
  ('007_economic_hypotheses'),
  ('008_zone_percentages'),
  ('009_roles'),
  ('010_zone_defaults_40_10_20_30');

-- Vérification de fin de bootstrap : la partie et l'état du tour doivent exister.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.games WHERE game_name = 'Anathas') THEN
    RAISE EXCEPTION 'Initialisation incomplète : partie Anathas absente.';
  END IF;
  IF to_regclass('public.v_player_dashboard') IS NULL OR to_regclass('public.v_player_history') IS NULL THEN
    RAISE EXCEPTION 'Initialisation incomplète : vues du dashboard absentes.';
  END IF;
END $$;

-- Tablanathas : répartitions de population des scénarios économiques de référence.
-- Dépend des migrations qui créent user_scenario_economic_parameters et ses colonnes
-- historiques. Migration additive : les anciens champs sont conservés pour compatibilité,
-- mais le code applicatif ne les utilise plus.

ALTER TABLE public.user_scenario_economic_parameters
  ADD COLUMN IF NOT EXISTS mixed_agriculture_industry_agriculture_population_pct numeric(8,2) NOT NULL DEFAULT 61.54,
  ADD COLUMN IF NOT EXISTS mixed_agriculture_industry_industry_population_pct numeric(8,2) NOT NULL DEFAULT 38.46,
  ADD COLUMN IF NOT EXISTS mixed_commerce_industry_industry_population_pct numeric(8,2) NOT NULL DEFAULT 45.45,
  ADD COLUMN IF NOT EXISTS mixed_commerce_industry_commerce_population_pct numeric(8,2) NOT NULL DEFAULT 54.55,
  ADD COLUMN IF NOT EXISTS military_industry_population_pct numeric(8,2) NOT NULL DEFAULT 6.49,
  ADD COLUMN IF NOT EXISTS military_commerce_population_pct numeric(8,2) NOT NULL DEFAULT 93.51,
  ADD COLUMN IF NOT EXISTS custom_agriculture_population_pct numeric(8,2) NOT NULL DEFAULT 33.33,
  ADD COLUMN IF NOT EXISTS custom_industry_population_pct numeric(8,2) NOT NULL DEFAULT 33.33,
  ADD COLUMN IF NOT EXISTS custom_commerce_population_pct numeric(8,2) NOT NULL DEFAULT 33.34,
  ADD COLUMN IF NOT EXISTS population_allocation_model_version smallint NOT NULL DEFAULT 0;

-- Reprise proportionnelle des réglages déjà personnalisés :
-- Agro-industrie : normalisation des parts agriculture / industrie.
-- Guerre : normalisation des parts industrie / commerce selon les anciens coefficients.
-- Les anciennes colonnes de calcul composite restent conservées à titre historique.
-- Le troisième poste du scénario personnalisé absorbe le résidu d'arrondi à 0,01 point.
WITH raw AS (
  SELECT p.scenario_id,
    GREATEST(p.agriculture_population_coefficient * p.mixed_agriculture_industry_agriculture_weight, 0) AS ao_a,
    GREATEST(p.industry_population_coefficient * p.mixed_agriculture_industry_industry_weight, 0) AS ao_i,
    GREATEST(p.industry_population_coefficient * p.mixed_commerce_industry_industry_weight, 0) AS as_i,
    GREATEST(p.commerce_population_coefficient * p.mixed_commerce_industry_commerce_weight, 0) AS as_c,
    GREATEST(p.industry_population_coefficient * p.military_industry_coefficient, 0) AS at_i,
    GREATEST(p.commerce_population_coefficient * p.military_commerce_coefficient, 0) AS at_c,
    GREATEST(p.custom_agriculture_weight, 0) AS custom_a,
    GREATEST(p.custom_industry_weight, 0) AS custom_i,
    GREATEST(p.custom_commerce_weight, 0) AS custom_c
  FROM public.user_scenario_economic_parameters p
  WHERE p.population_allocation_model_version = 0
), normalized AS (
  SELECT raw.*,
    ao_a + ao_i AS ao_total,
    as_i + as_c AS as_total,
    at_i + at_c AS at_total,
    custom_a + custom_i + custom_c AS custom_total
  FROM raw
)
UPDATE public.user_scenario_economic_parameters p
SET mixed_agriculture_industry_agriculture_population_pct =
      CASE WHEN n.ao_total > 0 THEN ROUND(100 * n.ao_a / n.ao_total, 2) ELSE 61.54 END,
    mixed_agriculture_industry_industry_population_pct =
      CASE WHEN n.ao_total > 0 THEN 100 - ROUND(100 * n.ao_a / n.ao_total, 2) ELSE 38.46 END,
    mixed_commerce_industry_industry_population_pct =
      CASE WHEN n.as_total > 0 THEN ROUND(100 * n.as_i / n.as_total, 2) ELSE 45.45 END,
    mixed_commerce_industry_commerce_population_pct =
      CASE WHEN n.as_total > 0 THEN 100 - ROUND(100 * n.as_i / n.as_total, 2) ELSE 54.55 END,
    military_industry_population_pct =
      CASE WHEN n.at_total > 0 THEN ROUND(100 * n.at_i / n.at_total, 2) ELSE 6.49 END,
    military_commerce_population_pct =
      CASE WHEN n.at_total > 0 THEN 100 - ROUND(100 * n.at_i / n.at_total, 2) ELSE 93.51 END,
    custom_agriculture_population_pct =
      CASE WHEN n.custom_total > 0 THEN ROUND(100 * n.custom_a / n.custom_total, 2) ELSE 33.33 END,
    custom_industry_population_pct =
      CASE WHEN n.custom_total > 0 THEN ROUND(100 * n.custom_i / n.custom_total, 2) ELSE 33.33 END,
    custom_commerce_population_pct =
      CASE WHEN n.custom_total > 0 THEN 100
        - (CASE WHEN n.custom_total > 0 THEN ROUND(100 * n.custom_a / n.custom_total, 2) ELSE 33.33 END)
        - (CASE WHEN n.custom_total > 0 THEN ROUND(100 * n.custom_i / n.custom_total, 2) ELSE 33.33 END)
      ELSE 33.34 END,
    population_allocation_model_version = 1,
    updated_at = now()
FROM normalized n
WHERE p.scenario_id = n.scenario_id;

ALTER TABLE public.user_scenario_economic_parameters
  ALTER COLUMN population_allocation_model_version SET DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.user_scenario_economic_parameters'::regclass AND conname = 'chk_usep_ao_population_pct') THEN
    ALTER TABLE public.user_scenario_economic_parameters ADD CONSTRAINT chk_usep_ao_population_pct
      CHECK (mixed_agriculture_industry_agriculture_population_pct BETWEEN 0 AND 100
         AND mixed_agriculture_industry_industry_population_pct BETWEEN 0 AND 100
         AND abs(mixed_agriculture_industry_agriculture_population_pct + mixed_agriculture_industry_industry_population_pct - 100) <= 0.00001);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.user_scenario_economic_parameters'::regclass AND conname = 'chk_usep_as_population_pct') THEN
    ALTER TABLE public.user_scenario_economic_parameters ADD CONSTRAINT chk_usep_as_population_pct
      CHECK (mixed_commerce_industry_industry_population_pct BETWEEN 0 AND 100
         AND mixed_commerce_industry_commerce_population_pct BETWEEN 0 AND 100
         AND abs(mixed_commerce_industry_industry_population_pct + mixed_commerce_industry_commerce_population_pct - 100) <= 0.00001);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.user_scenario_economic_parameters'::regclass AND conname = 'chk_usep_at_population_pct') THEN
    ALTER TABLE public.user_scenario_economic_parameters ADD CONSTRAINT chk_usep_at_population_pct
      CHECK (military_industry_population_pct BETWEEN 0 AND 100
         AND military_commerce_population_pct BETWEEN 0 AND 100
         AND abs(military_industry_population_pct + military_commerce_population_pct - 100) <= 0.00001);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.user_scenario_economic_parameters'::regclass AND conname = 'chk_usep_custom_population_pct') THEN
    ALTER TABLE public.user_scenario_economic_parameters ADD CONSTRAINT chk_usep_custom_population_pct
      CHECK (custom_agriculture_population_pct BETWEEN 0 AND 100
         AND custom_industry_population_pct BETWEEN 0 AND 100
         AND custom_commerce_population_pct BETWEEN 0 AND 100
         AND abs(custom_agriculture_population_pct + custom_industry_population_pct + custom_commerce_population_pct - 100) <= 0.00001);
  END IF;
END $$;

COMMENT ON COLUMN public.user_scenario_economic_parameters.mixed_agriculture_industry_agriculture_population_pct IS
  'Part de population affectée à l agriculture dans le scénario Agro-industrie; avec sa part industrie, le total vaut 100 %.';
COMMENT ON COLUMN public.user_scenario_economic_parameters.mixed_commerce_industry_industry_population_pct IS
  'Colonne historique dépréciée, conservée uniquement pour compatibilité ; non utilisée par le modèle économique actif.';
COMMENT ON COLUMN public.user_scenario_economic_parameters.military_industry_population_pct IS
  'Part affichée de population affectée à l industrie dans le scénario Guerre avant coefficient militarisé.';
COMMENT ON COLUMN public.user_scenario_economic_parameters.population_allocation_model_version IS
  'Version du modèle d allocation par scénario; 1 indique que les anciens paramètres ont été migrés vers des pourcentages propres à chaque scénario.';

COMMENT ON COLUMN public.user_scenario_economic_parameters.agriculture_population_coefficient IS
  'DEPRECATED : ancienne part générique partagée entre les scénarios; conservée pour compatibilité et non utilisée par le modèle actuel.';
COMMENT ON COLUMN public.user_scenario_economic_parameters.industry_population_coefficient IS
  'DEPRECATED : ancienne part générique partagée entre les scénarios; conservée pour compatibilité et non utilisée par le modèle actuel.';
COMMENT ON COLUMN public.user_scenario_economic_parameters.commerce_population_coefficient IS
  'DEPRECATED : ancienne part générique partagée entre les scénarios; conservée pour compatibilité et non utilisée par le modèle actuel.';



-- ===== 011_economic_population_factor_and_presets =====
ALTER TABLE public.user_game_settings
  ADD COLUMN IF NOT EXISTS population_in_economy_pct numeric(5,2) NOT NULL DEFAULT 80;
UPDATE public.user_game_settings
SET population_in_economy_pct = 80
WHERE population_in_economy_pct IS NULL;
ALTER TABLE public.user_game_settings
  ALTER COLUMN population_in_economy_pct SET DEFAULT 80,
  ALTER COLUMN population_in_economy_pct SET NOT NULL;

ALTER TABLE public.user_scenario_economic_parameters
  ADD COLUMN IF NOT EXISTS militarized_agro_industry_agriculture_population_pct numeric(8,2) NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS militarized_agro_industry_industry_population_pct numeric(8,2) NOT NULL DEFAULT 30;

UPDATE public.user_scenario_economic_parameters
SET mixed_agriculture_industry_agriculture_population_pct = 70,
    mixed_agriculture_industry_industry_population_pct = 30,
    updated_at = now()
WHERE mixed_agriculture_industry_agriculture_population_pct = 61.54
  AND mixed_agriculture_industry_industry_population_pct = 38.46;
UPDATE public.user_scenario_economic_parameters
SET military_industry_population_pct = 30,
    military_commerce_population_pct = 70,
    updated_at = now()
WHERE military_industry_population_pct = 6.49
  AND military_commerce_population_pct = 93.51;

ALTER TABLE public.user_scenario_economic_parameters
  ALTER COLUMN mixed_agriculture_industry_agriculture_population_pct SET DEFAULT 70,
  ALTER COLUMN mixed_agriculture_industry_industry_population_pct SET DEFAULT 30,
  ALTER COLUMN military_industry_population_pct SET DEFAULT 30,
  ALTER COLUMN military_commerce_population_pct SET DEFAULT 70,
  ALTER COLUMN militarized_agro_industry_agriculture_population_pct SET DEFAULT 70,
  ALTER COLUMN militarized_agro_industry_industry_population_pct SET DEFAULT 30;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.user_game_settings'::regclass AND conname = 'chk_user_game_settings_population_in_economy_pct') THEN
    ALTER TABLE public.user_game_settings ADD CONSTRAINT chk_user_game_settings_population_in_economy_pct CHECK (population_in_economy_pct BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.user_scenario_economic_parameters'::regclass AND conname = 'chk_usep_militarized_agro_industry_population_pct') THEN
    ALTER TABLE public.user_scenario_economic_parameters ADD CONSTRAINT chk_usep_militarized_agro_industry_population_pct
      CHECK (militarized_agro_industry_agriculture_population_pct BETWEEN 0 AND 100
         AND militarized_agro_industry_industry_population_pct BETWEEN 0 AND 100
         AND abs(militarized_agro_industry_agriculture_population_pct + militarized_agro_industry_industry_population_pct - 100) <= 0.00001);
  END IF;
END $$;

COMMENT ON COLUMN public.user_game_settings.population_in_economy_pct IS
  'Part de la population totale utilisée pour les calculs de potentiel économique.';
COMMENT ON COLUMN public.user_scenario_economic_parameters.militarized_agro_industry_agriculture_population_pct IS
  'Part de population affectée à l agriculture dans le scénario Agro-industrie militarisée.';
COMMENT ON COLUMN public.user_scenario_economic_parameters.militarized_agro_industry_industry_population_pct IS
  'Part affichée de population affectée à l industrie avant application du coefficient militarisé de 0,1.';
COMMENT ON COLUMN public.user_scenario_economic_parameters.mixed_commerce_industry_industry_population_pct IS
  'Champ historique conservé pour compatibilité ; aucun scénario actif ne l utilise.';
COMMENT ON COLUMN public.user_scenario_economic_parameters.mixed_commerce_industry_commerce_population_pct IS
  'Champ historique conservé pour compatibilité ; aucun scénario actif ne l utilise.';

INSERT INTO public.schema_migrations(migration_id)
VALUES ('011_economic_population_factor_and_presets')
ON CONFLICT (migration_id) DO NOTHING;

-- Vérification finale du modèle économique réellement attendu par l'application.
-- Ces contrôles sont exécutés dans la même transaction : en cas d'écart, tout le
-- bootstrap (schéma, vues, réglages et migrations) est annulé.
DO $bootstrap_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_game_settings'
      AND column_name = 'population_in_economy_pct'
      AND data_type = 'numeric'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'Bootstrap incomplet : user_game_settings.population_in_economy_pct absent ou nullable.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_scenario_economic_parameters'
      AND column_name = 'militarized_agro_industry_agriculture_population_pct'
      AND data_type = 'numeric'
      AND is_nullable = 'NO'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_scenario_economic_parameters'
      AND column_name = 'militarized_agro_industry_industry_population_pct'
      AND data_type = 'numeric'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'Bootstrap incomplet : colonnes du scénario Agro-industrie militarisée absentes ou nullable.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_game_settings'::regclass
      AND conname = 'chk_user_game_settings_population_in_economy_pct'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_scenario_economic_parameters'::regclass
      AND conname = 'chk_usep_militarized_agro_industry_population_pct'
  ) THEN
    RAISE EXCEPTION 'Bootstrap incomplet : contraintes du nouveau modèle économique absentes.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.schema_migrations
    WHERE migration_id = '011_economic_population_factor_and_presets'
  ) THEN
    RAISE EXCEPTION 'Bootstrap incomplet : migration 011 non enregistrée.';
  END IF;
END;
$bootstrap_check$;

COMMIT;
