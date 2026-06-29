import { ComponentIndex, ComponentType } from '../../services/componentIndex.js';

export async function libListMappings(args: {
  unmappedOnly?: boolean;
  filterType?: 'angular' | 'lit';
}) {
  const index = new ComponentIndex();
  const mappings = index.listMappings(args.filterType as ComponentType | undefined, args.unmappedOnly);

  return {
    mappings,
    count: mappings.length,
    filter: { unmappedOnly: args.unmappedOnly, filterType: args.filterType },
  };
}
