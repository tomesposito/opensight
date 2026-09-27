import world from './world.json' with { type: 'json' };
export { world };
export const WORLD_MAP = 'opensight-world';
export const countryNames = new Set(world.features.map(f => f.properties.name));
