import { createServer } from 'node:http';
import relayApiHandler from '../../relay/vercel-api-handler';

createServer(relayApiHandler).listen(Number(process.env.PORT), '127.0.0.1');
