# Shared development and visual testing

Claude and Codex use the same checkout, map packages, renderer, assets, and launch flow.

- Start `npm run dev` from the repository root. It serves the live client and co-op backend together at `http://localhost:2567/`.
- Use `http://localhost:2567/?play=operation&plot=downtown&seed=1` as the shared visual testing baseline (PLAN-10: every map is generated from a theme — downtown, industrial, suburb). Fixed maps load only with `&fixture=1` for task-specific tests.
- Reuse the running shared server. Do not start a separate Vite preview or another agent-specific build. Port 5173 is a compatibility redirect.
- `npm run play` builds and serves the same application at port 2567 for production checks. Stop development before starting it.
- Preserve the character/UI work when changing mechanics. The authored packages (Burger District and the other picture maps) remain mapgen fixtures, not player maps. See `docs/BURGER-DISTRICT-PARCELS.md` and the development instructions in `README.md`.
