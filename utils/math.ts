import { ControlPoint } from '../types';

declare const Delaunator: any;

/**
 * Calculates the cross product of two vectors (p1-p0) and (p2-p0)
 */
function crossProduct(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): number {
    return (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
}

/**
 * Checks if point p is inside triangle t0,t1,t2
 */
export function pointInTriangle(px: number, py: number, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): boolean {
    const b1 = crossProduct(px, py, x0, y0, x1, y1) < 0.0;
    const b2 = crossProduct(px, py, x1, y1, x2, y2) < 0.0;
    const b3 = crossProduct(px, py, x2, y2, x0, y0) < 0.0;
    return ((b1 === b2) && (b2 === b3));
}

/**
 * Calculates Barycentric coordinates (w0, w1, w2) for point P inside triangle A,B,C
 */
export function getBarycentric(
    px: number, py: number,
    ax: number, ay: number,
    bx: number, by: number,
    cx: number, cy: number
): [number, number, number] {
    const v0x = bx - ax, v0y = by - ay;
    const v1x = cx - ax, v1y = cy - ay;
    const v2x = px - ax, v2y = py - ay;
    
    const d00 = v0x * v0x + v0y * v0y;
    const d01 = v0x * v1x + v0y * v1y;
    const d11 = v1x * v1x + v1y * v1y;
    const d20 = v2x * v0x + v2y * v0y;
    const d21 = v2x * v1x + v2y * v1y;
    
    const denom = d00 * d11 - d01 * d01;
    
    // Check for degenerate triangles
    if (Math.abs(denom) < 1e-10) return [0.33, 0.33, 0.33];

    const v = (d11 * d20 - d01 * d21) / denom;
    const w = (d00 * d21 - d01 * d20) / denom;
    const u = 1.0 - v - w;
    
    return [u, v, w];
}

/**
 * Solves for Affine Transform Matrix that maps Source Triangle (u,v) to Dest Triangle (x,y).
 * 
 * We want a matrix M such that:
 * [x]   [a c e] [u]
 * [y] = [b d f] [v]
 * [1]   [0 0 1] [1]
 * 
 * Returns [a, b, c, d, e, f] for Context2D.setTransform(a, b, c, d, e, f)
 */
export function solveAffine(
    x0: number, y0: number,
    x1: number, y1: number,
    x2: number, y2: number,
    u0: number, v0: number,
    u1: number, v1: number,
    u2: number, v2: number
): number[] {
    // We can solve this by inverting the source matrix.
    // However, a direct linear equation solver for 3 points is faster.
    // x = a*u + c*v + e
    // y = b*u + d*v + f
    
    const det = u0 * (v1 - v2) - v0 * (u1 - u2) + (u1 * v2 - u2 * v1);

    if (Math.abs(det) < 1e-10) return [1, 0, 0, 1, 0, 0]; // Fallback identity

    const a = (x0 * (v1 - v2) - v0 * (x1 - x2) + (x1 * v2 - x2 * v1)) / det;
    const b = (y0 * (v1 - v2) - v0 * (y1 - y2) + (y1 * v2 - y2 * v1)) / det;
    const c = (u0 * (x1 - x2) - x0 * (u1 - u2) + (u1 * x2 - u2 * x1)) / det;
    const d = (u0 * (y1 - y2) - y0 * (u1 - u2) + (u1 * y2 - u2 * y1)) / det;
    const e = (u0 * (v1 * x2 - v2 * x1) - v0 * (u1 * x2 - u2 * x1) + x0 * (u1 * v2 - u2 * v1)) / det;
    const f = (u0 * (v1 * y2 - v2 * y1) - v0 * (u1 * y2 - u2 * y1) + y0 * (u1 * v2 - u2 * v1)) / det;

    return [a, b, c, d, e, f];
}

export function triangulate(points: ControlPoint[]): number[] {
    // Delaunator takes [x0, y0, x1, y1, ...]
    if (points.length < 3) return [];
    
    // We perform triangulation on the Screen Coordinates (x,y)
    // because that determines the topology of the mesh on the wall.
    const coords = new Float64Array(points.length * 2);
    for (let i = 0; i < points.length; i++) {
        coords[i * 2] = points[i].x;
        coords[i * 2 + 1] = points[i].y;
    }

    // @ts-ignore - Delaunator is global from CDN
    const delaunay = new Delaunator(coords);
    return Array.from(delaunay.triangles);
}