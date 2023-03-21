const dotenv = require("dotenv");

dotenv.config();

console.log(process.env.MYSQL_DATABASE)

module.exports = {
  development: {
    client: 'mysql',
    connection: {
      host : '127.0.0.1',
      port : 3306,
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
      host : '127.0.0.1',
      port : 3306,
      user : process.env.MYSQL_USERNAME,
      password : process.env.MYSQL_PASSWORD,
      database : process.env.MYSQL_DATABASE,
      socketPath: '/var/run/mysqld/mysqld.sock'
    }
  }
};
