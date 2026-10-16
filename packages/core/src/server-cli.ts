import { OpenLoopServer } from './server';

const port = parseInt(process.env.OPENLOOP_PORT || '19888', 10);
const host = process.env.OPENLOOP_HOST || '127.0.0.1';

const server = new OpenLoopServer({ port, host });

server
  .start()
  .then(() => {
    console.log(`\x1b[32m✔\x1b[0m openLoop Core 服务已就绪: http://${host}:${port}`);
    console.log(`WebSocket 实时日志总线: ws://${host}:${port}`);
  })
  .catch((err) => {
    console.error(`\x1b[31m✖\x1b[0m openLoop Core 启动失败:`, err);
    process.exit(1);
  });

process.on('SIGINT', async () => {
  await server.stop();
  process.exit(0);
});
