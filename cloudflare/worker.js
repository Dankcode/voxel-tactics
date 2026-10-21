import { Container, getContainer } from '@cloudflare/containers';

export class GameServer extends Container {
    defaultPort = 2567;
    sleepAfter = '10m';
    envVars = { NODE_ENV: 'production', PORT: '2567' };
}

export default {
    fetch(request, env) {
        // Colyseus uses in-memory matchmaking and rooms. All HTTP requests and
        // WebSocket upgrades must reach the same process, including room joins.
        return getContainer(env.GAME_SERVER, 'voxel-tactics').fetch(request);
    }
};
