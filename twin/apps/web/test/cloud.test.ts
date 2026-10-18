import type { Annotation } from '@twin/schema'
import { create } from '@react-three/test-renderer'
import { act, render } from '@testing-library/react'
import { useThree } from '@react-three/fiber'
import { Fragment, createElement } from 'react'
import { Box3, PerspectiveCamera, Vector3, type Camera } from 'three'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CameraBridge, useCameraBridge } from '../src/scene/annotations/cameraBridge'
import {
  CLOUD_OFFSET_PX,
  cloudPath,
  convexHull,
  layoutClouds,
  offsetHull,
  placeTags,
  projectBox,
  type Pt,
  type Rect,
} from '../src/scene/annotations/cloudPath'

const VIEW = { width: 1000, height: 700 }

function perimeter(poly: Pt[]): number {
  return poly.reduce((sum, p, i) => {
    const q = poly[(i + 1) % poly.length]
    return sum + Math.hypot(q[0] - p[0], q[1] - p[1])
  }, 0)
}

/** True when `p` lies inside or on the convex polygon `poly` (any winding). */
function inside(poly: Pt[], p: Pt): boolean {
  let sign = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
    if (Math.abs(cross) < 1e-6) continue
    const s = Math.sign(cross)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

function camera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(40, VIEW.width / VIEW.height, 0.1, 500)
  cam.position.set(20, 30, 50)
  cam.lookAt(20, 0, 18)
  cam.updateMatrixWorld()
  return cam
}

const rackBox = (x: number, z: number) => new Box3(new Vector3(x, 0, z), new Vector3(x + 0.6, 2.3, z + 1.2))

describe('revision clouds', () => {
  it('cloudPath returns closed path with arc count ≈ perimeter/(2r)', () => {
    const hull: Pt[] = [
      [100, 100],
      [400, 100],
      [400, 260],
      [100, 260],
    ]
    const r = 8
    const { d, arcs } = cloudPath(hull, r)
    expect(d.startsWith('M')).toBe(true)
    expect(d.trimEnd().endsWith('Z')).toBe(true)
    expect(d.match(/A/g)?.length).toBe(arcs)
    expect(Math.abs(arcs - perimeter(hull) / (2 * r))).toBeLessThanOrEqual(1)
    // the last arc lands back on the start point
    const start = d.match(/^M([\d.-]+) ([\d.-]+)/)
    const end = d.match(/ ([\d.-]+) ([\d.-]+) Z$/)
    expect(Number(end?.[1])).toBeCloseTo(Number(start?.[1]), 1)
    expect(Number(end?.[2])).toBeCloseTo(Number(start?.[2]), 1)
  })

  it('cloud bumps point outward: arcs sweep clockwise on a clockwise screen hull', () => {
    const ccw: Pt[] = [
      [100, 100],
      [100, 260],
      [400, 260],
      [400, 100],
    ]
    const hull = convexHull(ccw)
    // shoelace in screen space (y down): positive area means clockwise on screen
    const area = hull.reduce((s, p, i) => {
      const q = hull[(i + 1) % hull.length]
      return s + (p[0] * q[1] - q[0] * p[1])
    }, 0)
    expect(area).toBeGreaterThan(0)
    expect(cloudPath(hull, 8).d).toMatch(/A[\d.]+ [\d.]+ 0 0 1 /)
  })

  it('hull of boxes covers all projected corners', () => {
    const cam = camera()
    const corners = [rackBox(12, 10), rackBox(14.4, 10), rackBox(12, 13.6), rackBox(18, 17.2)].flatMap((b) =>
      projectBox(b, cam, VIEW.width, VIEW.height),
    )
    expect(corners).toHaveLength(32)
    const hull = convexHull(corners)
    for (const c of corners) expect(inside(hull, c)).toBe(true)
    const grown = offsetHull(hull, CLOUD_OFFSET_PX)
    for (const c of corners) expect(inside(grown, c)).toBe(true)
    // every corner sits at least ~the offset inside the grown hull
    for (const c of corners) {
      for (let i = 0; i < grown.length; i++) {
        const a = grown[i]
        const b = grown[(i + 1) % grown.length]
        const len = Math.hypot(b[0] - a[0], b[1] - a[1])
        const dist = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / len
        expect(dist).toBeGreaterThan(CLOUD_OFFSET_PX * 0.95)
      }
    }
  })

  it('projectBox drops corners behind the camera', () => {
    const cam = camera()
    const behind = new Box3(new Vector3(19, 29, 55), new Vector3(21, 31, 60))
    expect(projectBox(behind, cam, VIEW.width, VIEW.height)).toEqual([])
  })

  it('a single point or a flat box still grows into a closed cloud', () => {
    const grown = offsetHull(convexHull([[300, 300]]), CLOUD_OFFSET_PX)
    expect(grown.length).toBeGreaterThanOrEqual(8)
    expect(cloudPath(grown, 8).arcs).toBeGreaterThanOrEqual(3)
  })

  it('tag placement avoids overlapping other tags', () => {
    const square = (x: number, y: number, s: number): Pt[] => [
      [x, y],
      [x + s, y],
      [x + s, y + s],
      [x, y + s],
    ]
    // three clouds side by side; their natural "right of the cloud" spots collide
    const clouds = [
      { tag: 1, label: 'Air can’t carry 132 kW per rack', hull: square(300, 300, 60) },
      { tag: 2, label: 'CDU loop at 96% of capacity', hull: square(310, 315, 60) },
      { tag: 3, label: 'Floor load over 12 kN/m²', hull: square(305, 290, 60) },
    ]
    const tags = placeTags(clouds, VIEW)
    expect(tags.map((t) => t.tag)).toEqual([1, 2, 3])
    expect(new Set(tags.map((t) => t.choice)).size).toBe(3)
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) expect(overlaps(tags[i].bounds, tags[j].bounds)).toBe(false)
    }
    for (const t of tags) {
      expect(t.bounds.x).toBeGreaterThanOrEqual(0)
      expect(t.bounds.y).toBeGreaterThanOrEqual(0)
      expect(t.bounds.x + t.bounds.w).toBeLessThanOrEqual(VIEW.width)
      expect(t.bounds.y + t.bounds.h).toBeLessThanOrEqual(VIEW.height)
    }
  })

  it('tag goes to the left when the cloud hugs the right edge', () => {
    const hull: Pt[] = [
      [880, 300],
      [990, 300],
      [990, 400],
      [880, 400],
    ]
    const [tag] = placeTags([{ tag: 1, label: 'Hot aisle above 45 °C', hull }], VIEW)
    expect(tag.at[0]).toBeLessThan(880)
    expect(tag.align).toBe('end')
  })

  it('long labels wrap onto short lines', () => {
    const hull: Pt[] = [
      [100, 100],
      [200, 100],
      [200, 200],
      [100, 200],
    ]
    const label = 'Rows 3 to 5 draw 132 kW per rack, and the CRAH units can move about 40 kW of air per rack'
    const [tag] = placeTags([{ tag: 1, label, hull }], VIEW)
    expect(tag.lines.length).toBeGreaterThan(1)
    for (const line of tag.lines) expect(line.length).toBeLessThanOrEqual(34)
  })

  describe('layoutClouds', () => {
    const cam = camera()
    const boxes = new Map([
      ['rack:R3-00', rackBox(12, 10)],
      ['rack:R3-01', rackBox(12.6, 10)],
      ['rack:R5-00', rackBox(12, 17.2)],
    ])
    const project = (id: string) => {
      const box = boxes.get(id)
      return box ? projectBox(box, cam, VIEW.width, VIEW.height) : null
    }
    const note = (tag: number, objectIds: string[]): Annotation => ({ tag, objectIds, label: `Note ${tag}`, severity: 'problem' })

    it('draws one cloud per annotation with visible objects', () => {
      const clouds = layoutClouds([note(1, ['rack:R3-00', 'rack:R3-01']), note(2, ['rack:R5-00'])], project, VIEW)
      expect(clouds.map((c) => c.tag)).toEqual([1, 2])
      for (const c of clouds) expect(c.d).toMatch(/Z$/)
    })

    it('annotation for removed object disappears', () => {
      const annotations = [note(1, ['rack:R3-00']), note(2, ['rack:R5-00'])]
      expect(layoutClouds(annotations, project, VIEW)).toHaveLength(2)
      boxes.delete('rack:R3-00')
      const after = layoutClouds(annotations, project, VIEW)
      expect(after.map((c) => c.tag)).toEqual([2])
    })

    it('a cloud shrinks to the objects still rendered', () => {
      const both = layoutClouds([note(1, ['rack:R3-01', 'rack:R5-00'])], project, VIEW)[0]
      const one = layoutClouds([note(1, ['rack:R3-01', 'rack:gone'])], project, VIEW)[0]
      expect(one.arcs).toBeLessThan(both.arcs)
    })

    it('clouds entirely off screen are skipped', () => {
      const offscreen = (id: string) => (id === 'far' ? ([[-400, -300], [-350, -260]] as Pt[]) : project(id))
      expect(layoutClouds([note(1, ['far'])], offscreen, VIEW)).toEqual([])
    })
  })

  describe('<RevisionClouds />', () => {
    let RevisionClouds: typeof import('../src/scene/annotations/RevisionClouds').RevisionClouds
    let useTwinStore: typeof import('../src/state/store').useTwinStore
    let useSceneRegistry: typeof import('../src/scene/registry').useSceneRegistry
    const boxes = new Map<string, Box3>()

    beforeAll(async () => {
      // The store module creates the app's store on import; keep it from opening a real socket.
      vi.stubGlobal('WebSocket', class { readyState = 0 })
      ;({ RevisionClouds } = await import('../src/scene/annotations/RevisionClouds'))
      ;({ useTwinStore } = await import('../src/state/store'))
      ;({ useSceneRegistry } = await import('../src/scene/registry'))
    })

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
      boxes.clear()
      boxes.set('rack:R3-00', rackBox(12, 10))
      boxes.set('rack:R5-00', rackBox(12, 17.2))
      useSceneRegistry.setState({ worldBox: (id: string) => boxes.get(id)?.clone() ?? null })
    })

    afterEach(() => {
      act(() => useTwinStore.getState().dispatchView({ type: 'clearAnnotations' }))
      useCameraBridge.setState({ view: null })
      vi.useRealTimers()
    })

    const annotate = () =>
      act(() => {
        const { dispatchView } = useTwinStore.getState()
        dispatchView({
          type: 'annotate',
          annotation: { tag: 1, objectIds: ['rack:R3-00'], label: 'Air can’t carry 132 kW per rack', severity: 'problem' },
        })
        dispatchView({ type: 'annotate', annotation: { tag: 2, objectIds: ['rack:R5-00'], label: 'CDU at 96%', severity: 'warning' } })
        dispatchView({ type: 'annotate', annotation: { tag: 3, objectIds: ['rack:R5-00'], label: 'No uplink', severity: 'info' } })
      })
    const notes = (root: HTMLElement) => [...root.querySelectorAll('[role="note"]')].map((n) => n.getAttribute('aria-label'))

    it('draws clouds from the camera the bridge publishes', () => {
      const { container, unmount } = render(createElement(RevisionClouds))
      annotate()
      act(() => vi.advanceTimersByTime(100))
      expect(notes(container)).toEqual([])
      act(() => useCameraBridge.setState({ view: { camera: camera(), ...VIEW } }))
      act(() => vi.advanceTimersByTime(100))
      expect(notes(container)).toHaveLength(3)
      expect(container.querySelector('.rc-line')?.getAttribute('d')).toMatch(/^M.* Z$/)
      expect(container.querySelector('.rc-num')?.textContent).toBe('1')
      unmount()
    })

    it('shows severity by shape and words, not color alone', () => {
      const { container, unmount } = render(createElement(RevisionClouds, { view: () => ({ camera: camera(), ...VIEW }) }))
      annotate()
      act(() => vi.advanceTimersByTime(100))
      expect(notes(container)).toEqual([
        'Revision 1, problem: Air can’t carry 132 kW per rack',
        'Revision 2, warning: CDU at 96%',
        'Revision 3, information: No uplink',
      ])
      const shapes = [...container.querySelectorAll('.rc-severity')].map((g) => g.getAttribute('data-severity'))
      expect(shapes).toEqual(['problem', 'warning', 'info'])
      const paths = [...container.querySelectorAll('.rc-severity')].map((g) => g.innerHTML)
      expect(new Set(paths).size).toBe(3)
      unmount()
    })

    it('drops the cloud once its object is removed from the scene', () => {
      const { container, unmount } = render(createElement(RevisionClouds, { view: () => ({ camera: camera(), ...VIEW }) }))
      annotate()
      act(() => vi.advanceTimersByTime(100))
      expect(notes(container)).toHaveLength(3)
      boxes.delete('rack:R3-00')
      act(() => vi.advanceTimersByTime(100))
      expect(notes(container)).toEqual(['Revision 2, warning: CDU at 96%', 'Revision 3, information: No uplink'])
      act(() => useTwinStore.getState().dispatchView({ type: 'clearAnnotations' }))
      expect(notes(container)).toEqual([])
      unmount()
    })
  })

  it('<CameraBridge /> publishes the canvas camera and size while mounted', async () => {
    let canvasCamera: Camera | null = null
    const Probe = () => {
      canvasCamera = useThree((s) => s.camera)
      return null
    }
    const renderer = await create(createElement(Fragment, null, createElement(CameraBridge), createElement(Probe)))
    const view = useCameraBridge.getState().view
    expect(canvasCamera).not.toBeNull()
    expect(view?.camera).toBe(canvasCamera)
    expect(view?.width).toBeGreaterThan(0)
    expect(view?.height).toBeGreaterThan(0)
    await renderer.unmount()
    expect(useCameraBridge.getState().view).toBeNull()
  })
})
