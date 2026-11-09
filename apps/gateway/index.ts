import { createGateway } from './app';
import { gatewayConfig } from './config';
const config = gatewayConfig();
const server = createGateway(config).listen(config.port, '127.0.0.1', () => console.log(`CreatorTrace official data gateway: http://127.0.0.1:${config.port}`));
const stop = () => server.close(() => process.exit(0));
process.on('SIGINT', stop); process.on('SIGTERM', stop);
