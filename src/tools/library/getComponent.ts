import { ComponentIndex } from '../../services/componentIndex.js';

export async function libGetComponent(args: { selector: string }) {
  const index = new ComponentIndex();
  const rec = index.getBySelector(args.selector);
  if (!rec) throw new Error(`Component not found: ${args.selector}`);
  return rec;
}
