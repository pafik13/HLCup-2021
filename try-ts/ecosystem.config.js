module.exports = {
  apps: [
    {
      script: 'build/src/index.js',
      instances: '2',
      exec_mode: 'cluster',
      instance_var: 'INSTANCE_ID',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
