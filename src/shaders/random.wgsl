// Counter-based randomness: zero is valid; no particle ID bits are discarded.
fn hash_u32(value: u32) -> u32 {
    var x = value;
    x ^= x >> 16u;
    x *= 0x7FEB352Du;
    x ^= x >> 15u;
    x *= 0x846CA68Bu;
    return x ^ (x >> 16u);
}

fn particle_seed(id: u32, seed: u32, stream: u32) -> u32 {
    return hash_u32(id ^ hash_u32(seed ^ stream));
}

fn rand_f(state: ptr<function, u32>) -> f32 {
    *state += 0x9E3779B9u;
    // Exactly representable 24-bit samples in [0, 1), never rounded up to 1.
    return f32(hash_u32(*state) >> 8u) * (1.0 / 16777216.0);
}
