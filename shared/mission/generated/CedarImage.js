// Recorded analysis of docs/design/cedar-close-concept.png, viewed and transcribed for an offline regression.
// Footprints are intentionally adapted to combat scale; flow follows sidewalk → shared drive → back gardens.
export const CEDAR_IMAGE_SITE = {
    version: 1, id: 'cedar-image', name: 'Cedar Close · Image Study', theme: 'Suburbs', timeOfDay: 'dusk',
    source: 'docs/design/cedar-close-concept.png',
    imageSha256: 'a2b8126b2f2f4d677739fc305d69b47accc94a2f43662ac97b95149e6eeea012',
    buildings: [
        { id:'home-left', bounds:[0.06,0.22,0.39,0.55], program:'house',front:'s' },
        { id:'home-right',bounds:[0.56,0.22,0.88,0.55],program:'house',front:'s' }
    ],
    surfaces: [
        { bounds:[0,0.8,1,0.91],material:'asphalt' },
        { bounds:[0,0.73,1,0.79],material:'concrete' },
        { bounds:[0,0.94,1,1],material:'concrete' },
        { bounds:[0.43,0.12,0.51,0.79],material:'concrete' },
        { bounds:[0.91,0.15,0.97,0.79],material:'concrete' },
        { bounds:[0.12,0.08,0.29,0.17],material:'paving' },
        { bounds:[0.62,0.08,0.79,0.17],material:'deck' }
    ],
    insertion:[0.09,0.94],flow:[[0.47,0.74],[0.47,0.46],[0.47,0.16]]
};
