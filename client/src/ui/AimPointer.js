/** Own pointer lock for shooting. An unlocked click captures the mouse; it never fires a round. */
export class AimPointer {
    constructor(canvas, { changed = () => {}, failed = () => {} } = {}) {
        this.canvas = canvas; this.doc = canvas.ownerDocument; this.enabled = false;
        this.changed = changed; this.failed = failed; this.pending = false;
        this.onChange = () => {
            this.pending = false;
            if(this.locked)this.unavailable=false;
            if (this.locked && !this.enabled) this.release();
            this.changed(this.locked);
        };
        this.onError = error => { this.pending = false;this.unavailable=true;if (this.enabled) this.failed(error); };
        this.doc.addEventListener('pointerlockchange', this.onChange);
        this.doc.addEventListener('pointerlockerror', this.onError);
    }
    get locked() { return this.doc.pointerLockElement === this.canvas; }
    setEnabled(enabled) { this.enabled = enabled; if (!enabled) this.release(); }
    request() {
        if (!this.enabled || this.locked || this.pending) return;
        if (!this.canvas.requestPointerLock) { this.onError(Error('This browser does not support mouse capture.')); return; }
        this.pending = true;
        try {
            const result = this.canvas.requestPointerLock();
            result?.catch(error => this.onError(error));
        } catch(error) { this.onError(error); }
    }
    release() { if (this.locked) this.doc.exitPointerLock(); }
    dispose() {
        this.setEnabled(false);
        this.doc.removeEventListener('pointerlockchange', this.onChange);
        this.doc.removeEventListener('pointerlockerror', this.onError);
    }
}
