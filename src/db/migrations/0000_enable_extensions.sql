-- Custom SQL migration file, put your code below! --

-- Extensions required by the schema.
-- citext: case-insensitive text (users.email). gen_random_uuid() is built in on PG13+.
CREATE EXTENSION IF NOT EXISTS citext;