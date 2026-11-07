// Original synthesized clips plus the supplied Mixkit footsteps and explosion tails.
export const SOUNDS = Object.freeze({
    footsteps: 'mixkit-crunchy-footsteps-loop-535.wav',
    explosion: 'mixkit-explosion-hit-1704.wav',
    distantExplosion: 'mixkit-epic-impact-afar-explosion-2782.wav',
    shotgunPump: 'mixkit-shotgun-pump-1659.wav',
    handgunClick: 'mixkit-handgun-click-1660.mp3',
    rifleShot: 'rifleShot.wav', sniperShot: 'sniperShot.wav', shotgunShot: 'shotgunShot.wav',
    sidearmShot: 'sidearmShot.wav', suppressedShot: 'suppressedShot.wav', flameShot: 'flameShot.wav',
    rifleReload: 'rifleReload.wav', sniperReload: 'sniperReload.wav',
    impactUnit: 'impactUnit.wav', impactStone: 'impactStone.wav', impactMetal: 'impactMetal.wav',
    impactGlass: 'impactGlass.wav', impactWood: 'impactWood.wav', impactEarth: 'impactStone.wav',
    doorOpen: 'doorOpen.wav', doorKick: 'doorKick.wav', throwWhoosh: 'throwWhoosh.wav', meleeHit: 'meleeHit.wav',
    heal: 'heal.wav', recover: 'recover.wav', extract: 'extract.wav', overwatch: 'overwatch.wav',
    uiSelect: 'uiSelect.wav', uiConfirm: 'uiConfirm.wav', collapse: 'collapse.wav',
    hydroBurst: 'hydroBurst.wav', cryoBurst: 'cryoBurst.wav', anemoBurst: 'anemoBurst.wav', contactAlert: 'contactAlert.wav'
});

export function explosionSound(event, focus) {
    if (event.element === 'hydro') return 'hydroBurst';
    if (event.element === 'cryo') return 'cryoBurst';
    if (event.element === 'anemo') return 'anemoBurst';
    return focus && Math.hypot(event.x - focus.x, event.y - focus.z) > 18
        ? 'distantExplosion' : 'explosion';
}

export function weaponSound(weaponId) {
    return {
        repeater:'rifleShot',musket:'rifleShot',shortbow:'rifleShot',longrifle:'sniperShot',
        blunderbuss:'shotgunShot',handcannon:'sidearmShot',crossbow:'suppressedShot',firelance:'flameShot'
    }[weaponId] || null;
}

export function weaponHandlingSound(weaponId) {
    return {
        blunderbuss:'shotgunPump',handcannon:'handgunClick',longrifle:'sniperReload',
        repeater:'rifleReload',musket:'rifleReload',shortbow:'rifleReload',crossbow:'rifleReload',firelance:'rifleReload'
    }[weaponId] || null;
}

export function impactSound(family) {
    return { unit:'impactUnit',metal:'impactMetal',glass:'impactGlass',ice:'impactGlass',wood:'impactWood',plant:'impactWood',stone:'impactStone',earth:'impactStone' }[family] || 'impactStone';
}

const clampVolume = value => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : 0.65;

export class SoundPlayer {
    constructor({ volume = 0.65, contextFactory = () => {
        const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
        return Context ? new Context() : null;
    } } = {}) {
        this.volume = clampVolume(volume);
        this.contextFactory = contextFactory;
        this.buffers = new Map();
        this.voices = new Set();
        this.active = true;
        this.unlock = this.unlock.bind(this);
        globalThis.window?.addEventListener('pointerdown', this.unlock, { capture: true });
        globalThis.window?.addEventListener('keydown', this.unlock, { capture: true });
        globalThis.document?.addEventListener('visibilitychange', () => {
            if (document.hidden) this.stopAll();
        });
    }

    // Browsers require a real pointer/key gesture before starting audio.
    unlock() {
        try {
            if (!this.context) {
                this.context = this.contextFactory();
                if (!this.context) return;
                this.master = this.context.createGain();
                this.master.gain.value = this.volume;
                this.master.connect(this.context.destination);
                for (const [name, file] of Object.entries(SOUNDS)) {
                    const buffer = fetch(`/assets/audio/${file}`)
                        .then(response => {
                            if (!response.ok) throw Error(`HTTP ${response.status}`);
                            return response.arrayBuffer();
                        })
                        .then(bytes => this.context.decodeAudioData(bytes))
                        .catch(error => { console.warn(`Sound unavailable: ${name}`, error.message); return null; });
                    this.buffers.set(name, buffer);
                }
            }
            if (this.context.state === 'suspended') this.context.resume().catch(() => {});
        } catch { /* Audio is optional on browsers without Web Audio. */ }
    }

    setVolume(value) {
        this.volume = clampVolume(value);
        if (this.master) this.master.gain.value = this.volume;
        if (!this.volume) this.stopAll();
    }

    play(name, { loop = false, volume = 1, rate = 1 } = {}) {
        const silent = () => {};
        if (!name || !this.active || !this.volume || globalThis.document?.hidden || !this.buffers.has(name)) return silent;
        // Cap simultaneous blast tails (e.g. a carpet-bomb strike).
        if (this.voices.size >= 12) this.voices.values().next().value();
        let source, gain, stopped = false;
        const started = performance.now();
        const stop = () => {
            if (stopped) return;
            stopped = true;
            if (source) { source.onended = null; source.stop(); source.disconnect(); gain.disconnect(); }
            this.voices.delete(stop);
        };
        this.voices.add(stop);
        this.buffers.get(name).then(buffer => {
            if (stopped) return;
            // Do not replay a one-shot late after loading or a suspended browser tab.
            if (!buffer || !this.active || !this.volume || globalThis.document?.hidden || this.context.state !== 'running' || (!loop && performance.now() - started > 400)) { stop(); return; }
            source = this.context.createBufferSource();
            source.buffer = buffer;
            source.loop = loop;
            source.playbackRate.value = Math.max(0.5, Math.min(3, rate));
            gain = this.context.createGain();
            gain.gain.value = volume;
            source.connect(gain);
            gain.connect(this.master);
            source.onended = () => { source.disconnect(); gain.disconnect(); this.voices.delete(stop); stopped = true; };
            source.start();
        }).catch(() => stop());
        return stop;
    }

    stopAll() { for (const stop of [...this.voices]) stop(); }
}
