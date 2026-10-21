# Cloudflare hosting

Live solo game: https://voxel-tactics.lxu4354.workers.dev/

## Free solo edition (default)

`wrangler.jsonc` publishes the client as Cloudflare Workers Static Assets on the
Free plan. No Node server, Container, database, or paid binding is deployed.

```sh
npm ci
npx wrangler login
npm run deploy:check
npm run deploy
```

Wrangler runs `npm run build:solo` before uploading `client/dist`, then prints the
public `https://voxel-tactics.<account-subdomain>.workers.dev` URL.
Use the same command to publish updates.

The solo build supports generated operations, combat against AI, inventory, saved
setups and local AI profiles. Saves stay in the current browser. The hosted menu
omits online host/join controls and the AI cache uses local storage directly.
The separate campaign screen remains a fixture prototype.

Local development continues to use `npm run dev` on port 2567 with co-op enabled.
`npm run build` also retains all co-op features. Only `--mode solo` enables the
static hosting behavior.

Verify `/`, `/campaign.html`, and the shared game baseline
`/?play=operation&plot=downtown&seed=1`. Missing files return 404 rather than the
HTML game shell. `/staging.html` explains that this edition is solo-only.

## Optional full co-op hosting

`wrangler.coop.jsonc`, `cloudflare/worker.js`, and `Dockerfile` preserve a separate
Container deployment option. This requires running Docker, Node 22+, Workers Paid
and Containers enabled. See [Cloudflare pricing](https://developers.cloudflare.com/containers/platform/pricing/).

```sh
npm run deploy:coop
```

The Docker build synchronizes the content contract and builds the normal client.
Every HTTP request and WebSocket upgrade routes to the same named container;
`max_instances: 1` is intentional because Colyseus rooms and matchmaking live in
one process. It uses the `basic` instance type and sleeps after ten idle minutes.
AI cache files and active rooms can reset when the container restarts. Redeploy
when players have finished their matches.

The image excludes local environment files, cached profiles, Git history and
unrelated outputs, and runs as the unprivileged `node` user.
