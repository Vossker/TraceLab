import { createApp } from './app';
import { createGateway } from '../gateway/app';
import { gatewayConfig } from '../gateway/config';
const gateway = process.env.LIVE_GATEWAY_ENABLED === 'true' ? (() => {
  const config = gatewayConfig();
  return createGateway(config).listen(config.port, '127.0.0.1', () => console.log(`CreatorTrace official data gateway: http://127.0.0.1:${config.port}`));
})() : null;
const port = Number(process.env.PORT || 3001);
const server = createApp().listen(port, process.env.HOST || '127.0.0.1', () => console.log(`CreatorTrace API & production dashboard: http://127.0.0.1:${port}`));
const stop = () => { gateway?.close(); server.close(() => process.exit(0)); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
