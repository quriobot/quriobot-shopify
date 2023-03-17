module.exports = {
  apps: [{
    "script": "npm",
    "args": "start",
    "instances": "1",
    "exec_mode": "cluster",
    "name": "solodrop"
  }]
};