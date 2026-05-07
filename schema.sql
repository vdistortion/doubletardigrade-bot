CREATE TABLE IF NOT EXISTS tardigrades (
    id SERIAL PRIMARY KEY,
    text TEXT,
    description TEXT,
    image TEXT
);

CREATE TABLE IF NOT EXISTS daily_tardigrades (
    id SERIAL PRIMARY KEY,
    user_id TEXT,
    tardigrade_id INTEGER REFERENCES tardigrades(id),
    date DATE,
    UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS quiz_questions (
    id SERIAL PRIMARY KEY,
    question TEXT,
    options JSONB,
    correct INTEGER
);

CREATE TABLE IF NOT EXISTS quiz_answers (
    id SERIAL PRIMARY KEY,
    user_id TEXT,
    question_id INTEGER REFERENCES quiz_questions(id) ON DELETE CASCADE,
    is_correct BOOLEAN,
    UNIQUE(user_id, question_id)
);

CREATE TABLE IF NOT EXISTS bot_settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

INSERT INTO bot_settings (key, value) VALUES
    ('enable_messages', 'false'),
    ('enable_chats', 'false')
ON CONFLICT (key) DO NOTHING;
