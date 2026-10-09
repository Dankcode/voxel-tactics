// Small, dependency-free validator for the JSON Schema vocabulary used by the authoring contracts.
export function validateSchema(value,schema,path='$') {
    const fail=why=>{throw Error(`schema ${path}: ${why}`);};
    if(schema.enum&&!schema.enum.includes(value))fail('value outside enum');
    if(schema.type) {
        const ok=schema.type==='array'?Array.isArray(value):schema.type==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):schema.type==='integer'?Number.isInteger(value):schema.type==='number'?typeof value==='number'&&Number.isFinite(value):typeof value===schema.type;
        if(!ok)fail(`expected ${schema.type}`);
    }
    if(typeof value==='number'&&(value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity)))fail('number outside bounds');
    if(typeof value==='string') {
        if(schema.pattern&&!new RegExp(schema.pattern).test(value))fail('invalid string');
        if(value.length>(schema.maxLength??Infinity)||value.length<(schema.minLength??0))fail('invalid length');
    }
    if(Array.isArray(value)) {
        if(value.length<(schema.minItems??0)||value.length>(schema.maxItems??Infinity))fail('invalid array length');
        if(schema.items)value.forEach((v,i)=>validateSchema(v,schema.items,`${path}[${i}]`));
    } else if(value&&typeof value==='object') {
        for(const k of schema.required||[])if(!(k in value))fail(`missing ${k}`);
        for(const [k,v] of Object.entries(value))if(schema.properties?.[k])validateSchema(v,schema.properties[k],`${path}.${k}`);else if(schema.additionalProperties===false)fail(`unknown ${k}`);
    }
    return value;
}

export function validateFloorSpec(spec,program) {
    if(spec.building!==program.building||spec.floor!==program.floor)throw Error('floorspec.identity: building/floor mismatch');
    if(!Array.isArray(spec.rooms)||!spec.rooms.length)throw Error('floorspec.rooms: missing room priors');
    for(const r of spec.rooms) {
        if(!program.rooms.some(p=>p.kind===r.kind))throw Error(`floorspec.room: unknown kind ${r.kind}`);
        if(!Array.isArray(r.center)||r.center.length!==2||!r.center.every(n=>Number.isFinite(n)&&n>=0&&n<=1))throw Error('floorspec.center: expected normalized coordinates');
    }
    return spec;
}
