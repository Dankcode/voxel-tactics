// Tile-sized re-creations of CC0 city-kit facade treatments (see docs/ARCHITECTURE-ASSETS.md).
// Geometry stays inside its cell; bends share their exact footprint with ray hits and cover.
import { wallFootprint, curvedCornerFootprint, CURVED_WALL_MASKS } from '../../../../shared/voxel/ConnectedShapes.js';
import { prismGeometry } from './ConnectedPieces.js';
import { box, merge } from './Geo.js';
const P=(text,build)=>({meta:{group:'architecture',text},build});
const frame=(width,slot='frame',grid=[])=>[
    {slot:'glass',geometry:box(width-.1,.9,.035,0,.05)},
    {slot,geometry:merge([
        box(width,.05,.07,0,0),box(width,.05,.07,0,.95),
        box(.05,.9,.07,-width/2+.025,.05),box(.05,.9,.07,width/2-.025,.05),...grid
    ])}
];
export const ARCHITECTURE_PIECES={
    window_sash:P('Residential sash: pale frame and fine crossbars, no masonry surround',()=>frame(.9,'frame_white',[
        box(.035,.9,.06,0,.05),box(.8,.035,.06,0,.49)
    ])),
    window_ribbon:P('Continuous office ribbon window, dark aluminium perimeter',()=>frame(1)),
    window_factory:P('Industrial steel-grid window, three bays and two lights',()=>frame(1,'frame',[
        box(.028,.9,.06,-.16,.05),box(.028,.9,.06,.16,.05),box(.9,.028,.06,0,.49)
    ])),
    window_divided:P('Four-light divided window with a projecting sill',()=>[
        ...frame(.9,'frame_white',[box(.035,.9,.06,0,.05),box(.8,.035,.06,0,.49)]),
        {slot:'quoin',geometry:box(1.02,.07,.18,0,0,.025)}
    ]),
    window_shuttered:P('Residential sash with hinged louvered shutters',()=>[
        ...frame(.72,'frame_white',[box(.03,.9,.06,0,.05),box(.62,.035,.06,0,.49)]),
        {slot:'shutter',geometry:merge([-1,1].flatMap(s=>[
            box(.2,.94,.045,s*.42,.03,.015),
            ...Array.from({length:8},(_,i)=>box(.17,.045,.065,s*.42,.09+i*.105,.035).rotateX(-.22))
        ]))},
        {slot:'quoin',geometry:box(1.04,.065,.16,0,0,.02)}
    ]),
    window_hopper:P('Top-hinged utility window with a tilted upper light',()=>[
        {slot:'glass',geometry:merge([box(.86,.58,.035,0,.05),box(.86,.28,.035,0,.69).rotateX(-.28)])},
        {slot:'frame',geometry:merge([
            box(.96,.05,.07,0,0),box(.96,.05,.07,0,.95),box(.05,.9,.07,-.455,.05),box(.05,.9,.07,.455,.05),
            box(.86,.035,.06,0,.64),box(.035,.58,.06,0,.05),box(.3,.025,.08,0,.58,.06)
        ])}
    ])
};
for(let mask=0;mask<16;mask++) {
    const poly=wallFootprint(mask);
    ARCHITECTURE_PIECES[`facade_concrete_${mask}`]=P('Precast concrete with recessed storey joint',()=>[
        {slot:'self',geometry:prismGeometry(poly,0,.97)},
        {slot:'frame',geometry:prismGeometry(poly,.97,.987)},
        {slot:'self',geometry:prismGeometry(poly,.987,1)}
    ]);
    ARCHITECTURE_PIECES[`facade_stucco_${mask}`]=P('Smooth rendered facade with pale thin course',()=>[
        {slot:'self',geometry:prismGeometry(poly)},
        {slot:'frame_white',geometry:prismGeometry(poly,.96,.983)}
    ]);
    ARCHITECTURE_PIECES[`facade_metal_${mask}`]=P('Metal cassette facade with horizontal panel seams',()=>[
        {slot:'self',geometry:merge([prismGeometry(poly,0,.315),prismGeometry(poly,.331,.648),prismGeometry(poly,.664,1)])},
        {slot:'frame',geometry:merge([prismGeometry(poly,.315,.331),prismGeometry(poly,.648,.664)])}
    ]);
}
for(const mask of CURVED_WALL_MASKS) {
    const pane=curvedCornerFootprint(mask,.035),trim=curvedCornerFootprint(mask,.07);
    ARCHITECTURE_PIECES[`glaze_curve_${mask}`]=P('Quarter-circle glazing tangent to adjacent panels',()=>[
        {slot:'glass',geometry:prismGeometry(pane)}
    ]);
    ARCHITECTURE_PIECES[`glaze_curve_sill_${mask}`]=P('Continuous curved glass base rail',()=>[
        {slot:'frame',geometry:prismGeometry(trim,0,.05)}
    ]);
    ARCHITECTURE_PIECES[`glaze_curve_head_${mask}`]=P('Continuous curved glass head rail',()=>[
        {slot:'frame',geometry:prismGeometry(trim,.95,1)}
    ]);
}
