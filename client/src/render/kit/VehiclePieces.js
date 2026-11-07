import { box, softBox as roundedBox, merge, disc, profileX } from './Geo.js';
const softBox = (w, h, d, r) => roundedBox(w, h, d, r, 0);

const P = build => ({ meta: { group: 'vehicle', overhang: true, footprint: [4, 2] }, build });
const wheels = (positions, radius = .32) => {
    const tyres = [], rims = [];
    for (const [x, z] of positions) {
        tyres.push(disc(radius, .22, 16, x, radius, z));
        rims.push(disc(radius * .61, .235, 8, x, radius, z));
    }
    return [
        { slot: 'tyre', geometry: merge(tyres) },
        { slot: 'chrome', geometry: merge(rims) }
    ];
};
const lamps = (frontX, rearX, y, width) => [
    { slot: 'lamp', geometry: merge([-1, 1].map(s => softBox(.08, .18, .42, .025, 1).translate(frontX, y, s * width))) },
    { slot: 'tail', geometry: merge([-1, 1].map(s => softBox(.07, .2, .34, .02, 1).translate(rearX, y, s * width))) }
];

export const VEHICLE_PIECES = {
    car_sedan: P(() => {
        const lower = profileX([[-1.95,.25],[1.87,.25],[1.98,.42],[1.84,.65],[1.12,.77],[-1.52,.8],[-1.9,.68],[-1.98,.45]], 1.72, .055);
        const cabin = profileX([[-1.35,.76],[.91,.76],[.28,1.29],[-.88,1.31],[-1.35,1.03]], 1.46, .025);
        const roof = softBox(1.2,.07,1.5,.035,2).translate(-.32,1.29,0);
        const pillars = [
            box(.07,.82,.055).rotateZ(.87).translate(.91,.76,.72), box(.07,.82,.055).rotateZ(.87).translate(.91,.76,-.72),
            box(.07,.72,.055).rotateZ(-.707).translate(-1.35,.76,.72), box(.07,.72,.055).rotateZ(-.707).translate(-1.35,.76,-.72),
            box(.06,.55,.055,-.35,.76,.735), box(.06,.55,.055,-.35,.76,-.735)
        ];
        const trim = [
            softBox(.15,.16,1.76,.035,1).translate(1.88,.31,0), softBox(.14,.15,1.76,.03,1).translate(-1.91,.32,0),
            box(2.9,.055,.045,-.05,.3,.86), box(2.9,.055,.045,-.05,.3,-.86),
            box(.65,.17,.035,1.93,.43,0), box(.65,.035,.04,1.96,.51,0),
            box(.035,.025,1.25).rotateZ(.87).translate(.91,.76,0),
            ...[-1,1].flatMap(s => [softBox(.22,.1,.13,.025,1).translate(.55,.91,s*.87), box(.45,.025,.018,-.82,.67,s*.866), box(.45,.025,.018,.22,.67,s*.866)])
        ];
        return [
            { slot: 'carpaint', geometry: merge([lower, roof]) },
            { slot: 'glass_dark', geometry: cabin },
            { slot: 'frame', geometry: merge([...pillars, ...trim]) },
            ...wheels([[-1.25,-.84],[1.25,-.84],[-1.25,.84],[1.25,.84]]),
            ...lamps(1.94,-1.95,.53,.59)
        ];
    }),
    car_pickup: P(() => {
        const lower = profileX([[-1.96,.28],[1.88,.28],[1.98,.45],[1.85,.69],[1.1,.79],[-1.85,.82],[-1.98,.62]],1.82,.05);
        const cab = profileX([[-.35,.78],[1.16,.78],[.68,1.4],[-.24,1.4],[-.48,1.08]],1.58,.035);
        const roof = softBox(.96,.07,1.64,.025,1).translate(.22,1.4,0);
        const bed = [
            box(1.45,.12,1.46,-1.16,.72), box(1.5,.47,.1,-1.13,.79,.79), box(1.5,.47,.1,-1.13,.79,-.79),
            box(.1,.47,1.58,-1.88,.79,0), box(.1,.18,1.58,-.42,1.05,0),
            box(1.35,.035,.055,-1.16,1.25,.79), box(1.35,.035,.055,-1.16,1.25,-.79)
        ];
        const trim = [
            softBox(.16,.19,1.86,.035,1).translate(1.9,.34,0), softBox(.15,.18,1.86,.03,1).translate(-1.93,.34,0),
            box(.72,.22,.04,1.96,.48,0), box(.55,.025,.045,1.985,.52,0), box(.55,.025,.045,1.985,.61,0),
            box(2.7,.07,.055,-.05,.32,.91), box(2.7,.07,.055,-.05,.32,-.91),
            box(.07,.78,.06).rotateZ(.659).translate(1.16,.78,.8), box(.07,.78,.06).rotateZ(.659).translate(1.16,.78,-.8),
            box(.07,.63,.06).rotateZ(-.175).translate(-.35,.78,.8), box(.07,.63,.06).rotateZ(-.175).translate(-.35,.78,-.8),
            ...[-1,1].flatMap(s => [softBox(.25,.12,.15,.025,1).translate(.67,1.02,s*.92), box(.42,.025,.02,-.04,.8,s*.916)])
        ];
        return [
            { slot: 'carpaint', geometry: merge([lower, roof, ...bed]) },
            { slot: 'glass_dark', geometry: cab },
            { slot: 'self_dark', geometry: box(1.28,.035,1.35,-1.18,.85,0) },
            { slot: 'frame', geometry: merge(trim) },
            ...wheels([[-1.3,-.88],[1.28,-.88],[-1.3,.88],[1.28,.88]],.35),
            ...lamps(1.95,-1.96,.57,.65)
        ];
    })
};
export const VEHICLE_OVERHANG = new Set(Object.entries(VEHICLE_PIECES).filter(([, p]) => p.meta.overhang).map(([id]) => id));
