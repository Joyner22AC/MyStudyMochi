// Copyright (c) 2026 The DEsk authors. MIT; see LICENSE.txt.
// Verbatim selected routines from src/room.glsl at ec16818b69cba5f3049426df839e1596253032ca
#define ROOM_SEED_ROW 37
const float M_PI = 3.14159265358979323846;
struct mtl {
	vec3 albedo;
	float rough;
	float metal;
	vec3 emit;
	float coat;
	float coat_rough;
	float bump_freq;
	float bump_amp;
	float dust;
	float edge;
};

float clampf(float v, float lo, float hi)
{
	return v < lo ? lo : (v > hi ? hi : v);
}

float smoothstepf(float a, float b, float x)
{
	float t = clampf((x - a) / (b - a + 1e-9), 0.0, 1.0);
	return t * t * (3.0 - 2.0 * t);
}

float ssin(float x)
{
	return sin(x - 6.28318530717958648 * floor(x * 0.159154943091895336 + 0.5));
}

float spow(float x, float y)
{
	return pow(max(x, 0.0), y);
}

float atan2f(float y, float x)
{
	return (x == 0.0 && y == 0.0) ? 0.0 : atan(y, x);
}

uint room_mix(uint v)
{
	uint s = v * 747796405u + 2891336453u;
	uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
	return (w >> 22u) ^ w;
}

float room_hash(int x, int y)
{
	uint h = room_mix(uint(x) + room_mix(uint(y)));
	return float(h >> 8u) * (1.0 / 16777216.0);
}

float room_seed(int i, int salt)
{
	return room_hash(i, ROOM_SEED_ROW + salt);
}

float room_noise(float x, float y)
{
	float xi = floor(x), yi = floor(y);
	float xf = x - xi, yf = y - yi;
	float u = xf * xf * (3.0 - 2.0 * xf);
	float v = yf * yf * (3.0 - 2.0 * yf);
	int ix = int(xi), iy = int(yi);
	float a = room_hash(ix, iy);
	float b = room_hash(ix + 1, iy);
	float c = room_hash(ix, iy + 1);
	float d = room_hash(ix + 1, iy + 1);
	float top = a + (b - a) * u;
	float bot = c + (d - c) * u;
	return top + (bot - top) * v;
}

float room_fbm(float x, float y)
{
	float sum = 0.0, amp = 0.5, f = 1.0;
	for (int i = 0; i < 5; i++) {
		sum += amp * room_noise(x * f, y * f);
		amp *= 0.5;
		f *= 2.0;
	}
	return sum;
}

float room_fbm2(float x, float y)
{
	return room_noise(x, y) * 0.65 + room_noise(x * 2.17, y * 2.17) * 0.35;
}

float scratch_at(float u, float v, float spacing, float aniso, float halfw, float seed)
{
	float y = v / (spacing * aniso) + seed * 53.1;
	float warp = (room_fbm2(u / (spacing * 6.0) + seed * 3.1, y * 1.7) - 0.5)
		* spacing * 1.6;
	float x = (u + warp) / spacing + seed * 17.3;
	float d = abs(fract(x) - 0.5) * spacing;
	float line = smoothstepf(halfw, halfw * 0.22, d);
	float alive = room_noise(floor(x) * 1.73 + seed * 7.7, y * 6.0);
	return line * smoothstepf(0.50, 0.79, alive);
}

float nick_at(float u, float v, float freq, float seed)
{
	float n = room_noise(u * freq + seed * 91.7, v * freq + seed * 13.3);
	return smoothstepf(0.930, 0.997, n);
}

float room_touch(vec3 w)
{
	float front = smoothstepf(-6.0, 7.4, w.z);
	float dx = (w.x - 1.8) / 9.5, dz = (w.z - 1.4) / 6.2;
	float seat = exp(-(dx * dx + dz * dz));
	float patchy = room_fbm2(w.x * 0.19 + 3.3, w.z * 0.19 + 7.1);
	return clampf((front * 0.58 + seat * 0.62) * (0.40 + patchy * 1.25), 0.0, 1.0);
}

float room_sun(vec3 w)
{
	float side = smoothstepf(9.0, -13.0, w.x);
	float reach = smoothstepf(-11.0, 4.0, w.z);
	float uneven = room_fbm2(w.x * 0.11 + 21.0, w.z * 0.11 + 4.0);
	return clampf(side * reach * (0.30 + uneven * 1.05), 0.0, 1.0);
}

void walnut_at(vec3 q, float u, float v, inout mtl m, float plank, float use)
{
	float board = plank > 0.0 ? floor(u / plank) : 0.0;
	float bu = plank > 0.0 ? u - board * plank : u;
	float jitter = room_seed(int(board), 3);

	float pith = plank * (0.24 + jitter * 0.52);
	float wob = room_fbm(v * 0.09 + board * 3.7, 4.2) - 0.5;
	float r = abs(bu - pith + wob * plank * 0.30);

	float season = room_fbm2(r * 0.52 + board * 5.3, 2.7) - 0.5;
	float rate = (7.2 + jitter * 2.4) * (1.0 + season * 0.85);
	float ring = r * rate
		+ room_fbm(v * 0.16 + board * 2.1, r * 0.8) * 3.4
		+ room_fbm2(v * 0.62 + board * 9.1, r * 1.9) * 1.25;
	float g = 0.5 + 0.5 * ssin(ring * 2.0 * M_PI);
	g = spow(g, 2.7);

	float cath = smoothstepf(0.0, plank * 0.18, r);
	g = g + (g * 0.55 + 0.28 - g) * (1.0 - cath);

	float btone = room_seed(int(board), 4);
	vec3 light = vec3(0.234, 0.114, 0.049) * (0.80 + btone * 0.44);
	vec3 dark = vec3(0.052, 0.021, 0.009) * (0.82 + btone * 0.38);
	m.albedo = mix(light, dark, clampf(g, 0.0, 1.0));

	float fleck = spow(room_noise(u * 46.0, v * 7.0), 7.0);
	m.albedo += vec3(0.14, 0.11, 0.07) * fleck;
	float sap = smoothstepf(0.62, 0.86, room_fbm(u * 0.5 + 31.0, v * 0.11));
	m.albedo = mix(m.albedo, vec3(0.265, 0.190, 0.124), sap * 0.35);

	float pore = spow(room_noise(u * 130.0, v * 6.5), 4.0);
	m.albedo *= 1.0 - pore * 0.30;

	if (plank > 0.0) {
		float seam = abs(bu - plank * 0.5);
		seam = smoothstepf(plank * 0.5, plank * 0.5 - 0.055, seam);
		m.albedo *= 1.0 - seam * 0.55;
	}

	m.rough = 0.26 + g * 0.13 + pore * 0.22;
	m.coat = 0.26 + room_fbm2(u * 0.42 + 8.0, v * 0.42) * 0.14;
	m.coat_rough = 0.19 + room_fbm(u * 0.8, v * 0.8) * 0.085;
	m.bump_freq = 26.0;
	m.bump_amp = 0.030;
	m.dust = 1.0;

	if (use <= 0.0) {
		return;
	}

	float touch = clampf(use * (0.30 + 0.85 * room_touch(q)), 0.0, 1.0);

	float bleach = room_sun(q) * (0.55 + 0.45 * use);
	vec3 faded = mix(m.albedo, vec3(0.208, 0.156, 0.112), 0.62);
	m.albedo = mix(m.albedo, faded, bleach * 0.40);

	float sc = scratch_at(u, v, 1.90, 13.0, 0.026, 1.0) * 0.85
		+ scratch_at(v, u, 3.40, 17.0, 0.034, 6.0) * 0.62
		+ scratch_at(u, v, 0.52, 8.0, 0.010, 13.0) * 0.48;
	sc = clampf(sc, 0.0, 1.0);
	sc = clampf(sc * (0.35 + touch * 1.35), 0.0, 1.0);

	float nick = nick_at(u, v, 1.5, 3.0) * clampf(0.30 + touch, 0.0, 1.0);

	float worn = clampf(touch * 1.05 + sc * 0.90, 0.0, 1.0);
	m.coat = clampf(m.coat - 0.42 * worn, 0.04, 1.0);
	m.coat_rough = clampf(m.coat_rough + worn * 0.30 + sc * 0.14, 0.02, 1.0);
	m.rough = clampf(m.rough + worn * 0.18 + sc * 0.20, 0.05, 1.0);

	m.albedo = mix(m.albedo, (m.albedo + vec3(0.055, 0.044, 0.034)) * 1.55, sc * 0.62);
	m.albedo = mix(m.albedo, m.albedo * 0.40, nick * 0.85);
	m.rough = clampf(m.rough + nick * 0.30, 0.05, 1.0);
	m.coat = clampf(m.coat * (1.0 - nick * 0.80), 0.0, 1.0);

	m.edge = 1.0 + use * 1.5;

	float grime = (1.0 - touch) * use * 0.55
		* clampf(room_fbm2(q.x * 0.34 + 11.0, q.z * 0.34 + 2.0) * 1.5 - 0.30, 0.0, 1.0);
	m.albedo = mix(m.albedo, vec3(0.062, 0.050, 0.042), grime * 0.26);
	m.rough = clampf(m.rough + grime * 0.16, 0.05, 1.0);
}

void desk_stains(vec3 w, inout mtl m)
{
	const vec4 RING[3] = vec4[3](
		vec4(-2.10, 3.40, 1.30, 1.00),
		vec4(5.70, 0.90, 1.14, 0.72),
		vec4(-6.90, -1.10, 1.46, 0.46));
	for (int i = 0; i < 3; i++) {
		float dx = w.x - RING[i].x, dz = w.z - RING[i].y;
		float d = sqrt(dx * dx + dz * dz);
		float edge = smoothstepf(0.17, 0.02, abs(d - RING[i].z));
		float inside = smoothstepf(RING[i].z, RING[i].z - 0.55, d);
		float a = atan2f(dz, dx);
		float keep = smoothstepf(0.28, 0.64,
			room_fbm2(cos(a) * 1.7 + float(i) * 7.3, sin(a) * 1.7 + float(i) * 2.9));
		float ring = edge * keep * RING[i].w;
		m.albedo = mix(m.albedo, m.albedo * 0.58, ring * 0.60);
		m.albedo = mix(m.albedo, m.albedo * 1.12, inside * keep * RING[i].w * 0.14);
		m.rough = clampf(m.rough + ring * 0.26, 0.05, 1.0);
		m.coat = clampf(m.coat * (1.0 - ring * 0.60), 0.0, 1.0);
	}
	float sx = (w.x - 8.60) / 2.30, sz = (w.z + 4.10) / 1.70;
	float sd = sqrt(sx * sx + sz * sz) * (0.75 + room_fbm2(w.x * 0.8 + 3.0, w.z * 0.8) * 0.6);
	float spill = smoothstepf(1.05, 0.45, sd);
	m.albedo = mix(m.albedo, m.albedo * 0.68, spill * 0.40);
	m.coat = clampf(m.coat * (1.0 - spill * 0.50), 0.0, 1.0);
	m.rough = clampf(m.rough + spill * 0.14, 0.05, 1.0);
}
