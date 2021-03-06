/** @format */

const download = require('@now/build-utils/fs/download.js'); // eslint-disable-line import/no-extraneous-dependencies
const {createLambda} = require('@now/build-utils/lambda.js'); // eslint-disable-line import/no-extraneous-dependencies
const path = require('path');
const rename = require('@now/build-utils/fs/rename.js'); // eslint-disable-line import/no-extraneous-dependencies
const {runNpmInstall} = require('@now/build-utils/fs/run-user-scripts.js');

const FileBlob = require('@now/build-utils/file-blob.js');
const FileFsRef = require('@now/build-utils/file-fs-ref.js');
const fs = require('fs-extra');

const {spawn} = require('child_process');
function spawnAsync(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {stdio: 'inherit', cwd});
    child.on('error', reject);
    child.on('close', (code, signal) =>
      code !== 0
        ? reject(new Error(`Exited with ${code || signal}`))
        : resolve(),
    );
  });
}

exports.config = {
  maxLambdaSize: '10mb',
};

exports.build = async ({files, entrypoint, workPath}) => {
  // move all user code to 'user' subdirectory
  const userFiles = rename(files, name => path.join('user', name));

  const userPath = path.join(workPath, 'user');
  await download(files, userPath);
  await runNpmInstall(userPath, ['--prefer-offline']);

  // Get launcher
  const launcherFiles = {
    'launcher.js': new FileBlob({
      data: `
const { Server } = require('http');
const { Bridge } = require('./bridge.js');

const bridge = new Bridge();
bridge.port = 3000;
let listener;

try {
  process.env.PORT = bridge.port
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'production';
  }

  process.chdir("./user")

  listener = require("./${path.join(
    'user',
    '__sapper__/build/server/server.js',
  )}");

  if (listener.default) {
    listener = listener.default;
  }
} catch (error) {
  bridge.userError = error;
}

const server = new Server(listener);
server.listen(bridge.port);

exports.launcher = bridge.launcher;
`,
    }),
    'bridge.js': new FileFsRef({fsPath: require('@now/node-bridge')}),
  };

  const lambda = await createLambda({
    files: {...userFiles, ...launcherFiles},
    handler: 'launcher.launcher',
    runtime: 'nodejs8.10',
  });

  return {[entrypoint]: lambda};
};
