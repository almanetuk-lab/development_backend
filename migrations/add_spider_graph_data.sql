ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS spider_graph_data JSONB;
