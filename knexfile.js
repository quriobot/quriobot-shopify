const dotenv = require("dotenv");

dotenv.config();

module.exports = {
  development: {
    client: 'mysql',
    connection: {
      host : process.env.MYSQL_HOST,
      port : process.env.MYSQL_PORT,
      user : process.env.MYSQL_USERNAME,
      password : process.env.MYSQL_PASSWORD,
      database : process.env.MYSQL_DATABASE,
      socketPath: '/var/run/mysqld/mysqld.sock'
    }
  },
  staging: {
    
  },
  production: {
    client: 'mysql',
    connection: {
      host : process.env.MYSQL_HOST,
      port : process.env.MYSQL_PORT,
      user : process.env.MYSQL_USERNAME,
      password : process.env.MYSQL_PASSWORD,
      database : process.env.MYSQL_DATABASE,
      socketPath: '/var/run/mysqld/mysqld.sock'
    }
  }
};
