-- Seed initial users from users.json
INSERT INTO users (id,name,role,color,password) VALUES ('abner','Abner','Admin','#3742fa','$2b$10$KnJlQTb9opcUu2EVPkw56ez410v9.LNBFLNGV200EiXskvMjjnUla') ON CONFLICT (id) DO NOTHING;
INSERT INTO users (id,name,role,color,password) VALUES ('nonoke','Nonoke','Admin','#2ed573','$2b$10$Yw5pRKQxLCrzp9Bkny0g0uS9oiefl3Knqlwom97bmO7Kj7OpKX/Zm') ON CONFLICT (id) DO NOTHING;
INSERT INTO users (id,name,role,color,password) VALUES ('elias','Elias','Admin','#ffa502','$2b$10$Yw5pRKQxLCrzp9Bkny0g0uS9oiefl3Knqlwom97bmO7Kj7OpKX/Zm') ON CONFLICT (id) DO NOTHING;
