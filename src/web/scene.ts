import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { signedArea } from '../core/geometry/polygon.js';
import type { Part, PartProgress, WorkType } from '../core/types.js';

export type ViewPreset = 'iso' | 'sea' | 'top' | 'section';
export type ThemeName = 'light' | 'dark';

interface TrackedMesh {
  mesh: THREE.Mesh;
  part: Part;
  plane: THREE.Plane | null;
  material: THREE.MeshStandardMaterial;
}

const ACCENT = 0x6a4fc8;

export class StudioScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly group: THREE.Group;
  private readonly grid: THREE.GridHelper;
  private readonly water: THREE.Mesh;
  private readonly workTypeColors: Map<string, string>;
  private readonly resizeObserver: ResizeObserver;
  private tracked: TrackedMesh[] = [];
  private raf = 0;
  private bounds = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  private theme: ThemeName;

  constructor(canvas: HTMLCanvasElement, workTypes: readonly WorkType[], theme: ThemeName) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.localClippingEnabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(theme === 'dark' ? '#0e141a' : '#eef2f6');
    this.theme = theme;

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 20_000);
    this.camera.position.set(120, 90, 140);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(50, -5, 0);
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.update();

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.35));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(120, 180, 90);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xcfe6ff, 0.5);
    fill.position.set(-120, 60, -90);
    this.scene.add(fill);

    const gridColor = theme === 'dark' ? 0x2b3a48 : 0xb9c7d4;
    this.grid = new THREE.GridHelper(600, 60, gridColor, gridColor);
    const gridMaterial = this.grid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.35;
    this.scene.add(this.grid);

    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.MeshStandardMaterial({
        color: theme === 'dark' ? 0x1d4a5e : 0x2b86a8,
        transparent: true,
        opacity: 0.16,
        roughness: 0.4,
        metalness: 0,
        depthWrite: false,
      }),
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = 0;
    this.scene.add(this.water);

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.workTypeColors = new Map(workTypes.map((workType) => [workType.code, workType.color]));

    this.resizeObserver = new ResizeObserver(() => this.resize());
    const parent = canvas.parentElement ?? canvas;
    this.resizeObserver.observe(parent);
    this.resize();

    const animate = () => {
      this.raf = requestAnimationFrame(animate);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }

  private resize(): void {
    const canvas = this.renderer.domElement;
    const parent = canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth ?? canvas.clientWidth ?? 640);
    const height = Math.max(1, parent?.clientHeight ?? canvas.clientHeight ?? 360);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  setParts(parts: readonly Part[]): void {
    for (const tracked of this.tracked) {
      tracked.mesh.geometry.dispose();
      tracked.material.dispose();
      this.group.remove(tracked.mesh);
    }
    this.tracked = [];

    for (const part of parts) {
      const points = ensureCcw(part.points);
      if (points.length < 3) continue;
      const shape = new THREE.Shape(points.map((point) => new THREE.Vector2(point.x, point.y)));
      const height = Math.max(0.01, part.top - part.bottom);
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: height,
        bevelEnabled: false,
        curveSegments: 1,
      });
      geometry.rotateX(-Math.PI / 2);

      const color = this.workTypeColors.get(part.workTypeCode) ?? '#6b7f8f';
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        roughness: 0.72,
        metalness: 0.04,
        side: THREE.DoubleSide,
      });
      let plane: THREE.Plane | null = null;
      if (part.sequence === 'extend') {
        const bounds = xBounds(points);
        plane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), bounds.maxX + 1);
        material.clippingPlanes = [plane];
        material.clipShadows = true;
      }

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = part.bottom;
      mesh.userData.partId = part.id;
      this.group.add(mesh);
      this.tracked.push({ mesh, part, plane, material });
    }

    this.bounds = new THREE.Box3().setFromObject(this.group);
    if (this.tracked.length > 0) this.fit();
  }

  update(progressList: readonly PartProgress[]): void {
    const map = new Map(progressList.map((item) => [item.partId, item]));
    for (const tracked of this.tracked) {
      const state = map.get(tracked.part.id);
      if (!state || !state.visible) {
        tracked.mesh.visible = false;
        continue;
      }
      tracked.mesh.visible = true;
      if (tracked.part.sequence === 'stack') {
        const scale = Math.min(1, Math.max(0.0001, state.scaleY ?? state.progress));
        tracked.mesh.scale.y = scale;
        tracked.mesh.position.y = tracked.part.bottom;
      } else {
        tracked.mesh.scale.y = 1;
        tracked.mesh.position.y = tracked.part.bottom;
      }
      if (tracked.plane && state.clipX !== undefined) {
        tracked.plane.constant = state.clipX;
      }
    }
  }

  highlightWorkType(code: string | null): void {
    for (const tracked of this.tracked) {
      const selected = code !== null && tracked.part.workTypeCode === code;
      tracked.material.emissive.setHex(selected ? ACCENT : 0x000000);
      tracked.material.emissiveIntensity = selected ? 0.5 : 0;
    }
  }

  highlight(partId: string | null): void {
    for (const tracked of this.tracked) {
      const selected = tracked.part.id === partId;
      tracked.material.emissive.setHex(selected ? ACCENT : 0x000000);
      tracked.material.emissiveIntensity = selected ? 0.55 : 0;
    }
  }

  setView(preset: ViewPreset): void {
    this.fit(preset);
  }

  fit(preset: ViewPreset = 'iso'): void {
    const center = this.bounds.getCenter(new THREE.Vector3());
    const size = this.bounds.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z, 5);
    const distance = span * 1.9 + 8;
    const targetY = Number.isFinite(center.y) ? center.y : 0;
    this.controls.target.set(center.x, targetY, center.z);
    this.camera.up.set(0, 1, 0);
    switch (preset) {
      case 'sea':
        this.camera.position.set(center.x, targetY + span * 0.45, center.z + distance);
        break;
      case 'top':
        this.camera.up.set(0, 0, -1);
        this.camera.position.set(center.x, targetY + distance * 1.15, center.z + 0.01);
        break;
      case 'section':
        this.camera.position.set(center.x - distance, targetY + span * 0.35, center.z);
        break;
      case 'iso':
      default:
        this.camera.position.set(center.x + distance * 0.72, targetY + distance * 0.58, center.z + distance * 0.78);
        break;
    }
    this.camera.near = Math.max(0.05, span / 500);
    this.camera.far = span * 40 + 500;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  setTheme(theme: ThemeName): void {
    if (theme === this.theme) return;
    this.theme = theme;
    this.scene.background = new THREE.Color(theme === 'dark' ? '#0e141a' : '#eef2f6');
    const gridMaterial = this.grid.material as THREE.Material;
    gridMaterial.needsUpdate = true;
    (this.water.material as THREE.MeshStandardMaterial).color.setHex(theme === 'dark' ? 0x1d4a5e : 0x2b86a8);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    for (const tracked of this.tracked) {
      tracked.mesh.geometry.dispose();
      tracked.material.dispose();
    }
    this.tracked = [];
    this.grid.geometry.dispose();
    (this.grid.material as THREE.Material).dispose();
    this.water.geometry.dispose();
    (this.water.material as THREE.Material).dispose();
    this.renderer.dispose();
  }
}

function ensureCcw(points: readonly { x: number; y: number }[]): { x: number; y: number }[] {
  const copy = points.map((point) => ({ x: point.x, y: point.y }));
  return signedArea(copy) < 0 ? copy.reverse() : copy;
}

function xBounds(points: readonly { x: number }[]): { minX: number; maxX: number } {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
  }
  return { minX, maxX };
}
