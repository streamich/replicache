import {assertString} from '../asserts';
import {Hash, hashOf} from '../hash';
import type {Value} from '../kv/store';

type Refs = readonly Hash[];

export class Chunk<V extends Value = Value> {
  readonly hash: Hash;
  readonly data: V;
  /**
   * Meta is an array of refs. If there are no refs we do not write a meta
   * chunk.
   */
  readonly meta: Refs;

  private constructor(hash: Hash, data: V, meta: Refs) {
    this.hash = hash;
    this.data = data;
    this.meta = meta;
  }

  static new<V extends Value = Value>(data: V, refs: Refs): Chunk<V> {
    const hash = hashOf(JSON.stringify(data));
    return new Chunk(hash, data, refs);
  }

  static read<V extends Value = Value>(
    hash: Hash,
    data: V,
    refs: Refs,
  ): Chunk<V> {
    return new Chunk(hash, data, refs);
  }
}

export function assertMeta(v: unknown): asserts v is Refs {
  if (!Array.isArray(v)) {
    throw new Error('Meta must be an array');
  }
  for (const e of v) {
    assertString(e);
  }
}
