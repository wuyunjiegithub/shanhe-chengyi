import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { createPlateMesh, CAP_MATERIAL_INDEX } from './plates';
import type { PlateStyle } from './plates';
import type { TerrainHandle } from './terrain';
import { createPin, disposePin, disposePinGeometries } from './pins';
import type { PinInput, PinRecord } from './pins';
import {
  FAVORITE_SCREEN_PX,
  MARKER_ASPECT,
  MARKER_H,
  MARKER_W,
  VISITED_SCREEN_PX,
  paintFavorite,
  paintVisited,
} from './markerArt';
import type { MarkerKind, VisitedStyle } from './markerArt';
import type { ProjectedShape, Province, WeatherKind } from '../data/types';
import { WeatherFX } from './weatherFX';

const PROVINCE_COLOR: Record<Province, number> = {
  上海市: 0x00f2fe,
  江苏省: 0x38bdf8,
  浙江省: 0x34d399,
  安徽省: 0xfbbf24,
};

/**
 * 「老家视图」= 江浙沪皖四省。
 * 全国化之后底图是 369 城，若按整幅中国取景，江浙沪皖只占中间一小块、观感很空。
 * 首屏与「重置视角」都按这四省取景（与全国化之前完全一致），其余省份靠拖动 / 缩放去看。
 */
const HOME_PROVINCES: readonly string[] = ['江苏省', '浙江省', '上海市', '安徽省'];

const ACTIVE_EMISSIVE = 0x22d3ee;
const SELECTED_FACE = 0x2b3e59;
const FACE_INDEXED = 0x1c2839;
const FACE_MUTED = 0x151d29;
const SIDE_INDEXED = 0x0c1420;
const SIDE_MUTED = 0x0a1018;
const CITY_HEIGHT = 2.6;
/**
 * 城市视图里「区县层」的基准高度：必须整体抬到城市板块顶面之上。
 * 区县板只有 1.0 高，若和城市板（2.6 高）同在 y=0 起算，从 50° 俯角看下去
 * 城市板的顶面在区县顶面之上，会整层把区县盖住——这正是「区县分割线怎么都看不见」的真因
 * （描边线本身是渲染出来的，只是被压在城市板下面）。
 */
const DISTRICT_BASE_Y = CITY_HEIGHT + 0.03;
/** 区县板块基础高度：城市视图里区县是细节层。压得很低，让群岛（如舟山 200+ 离岛）
 *  读作「铺开在海面上的低地块」而不是一根根柱子；同时远低于城市板块，层次分明。 */
const DISTRICT_HEIGHT = 1.0;
const ELEV_DEG = 50;
/** 景点 pin 的目标屏幕直径（px），由相机距离反算世界缩放 */
const PIN_SCREEN_PX = 12.5;

interface PlateRecord {
  /** 一个要素可能有多块网格（海岛 / 飞地各一块），全部参与拾取与样式 */
  meshes: THREE.Mesh[];
  capMaterials: THREE.MeshStandardMaterial[];
  edgeMaterials: LineMaterial[];
  /** 默认边界色（高对比的浅色，保证相邻区县之间有清晰分界线） */
  baseEdgeColor: number;
  baseCapColor: number;
  /** 聚焦态下其余城市的暗化色（保留省份色相，压暗而非抹黑） */
  mutedCapColor: number;
  mutedEdgeColor: number;
  baseEmissive: number;
  baseIntensity: number;
  baseEdgeOpacity: number;
  centroid: [number, number];
  height: number;
  /** 悬停抬起量（按板块厚度自适应，避免薄片浮空） */
  lift: number;
  /** 抬升基座：板块被抬起时从地面连到板底，避免薄板悬空露出难看截面 */
  pedestals: THREE.Mesh[];
  /** 目标高度（position.y 由 tick 平滑趋近） */
  targetY: number;
}

export interface PickInfo {
  kind: 'city' | 'district' | 'pin';
  id: string;
  name: string;
  province?: string;
  districtId?: string;
  districtName?: string;
}

export interface AnchorInfo {
  id: string;
  name: string;
  city: string;
  spotCount: number;
}

export class SceneManager {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private cityGroup = new THREE.Group();
  private districtGroup = new THREE.Group();
  private pinGroup = new THREE.Group();
  private cityMarkerGroup = new THREE.Group();
  private districtMarkerGroup = new THREE.Group();
  /** 标记贴图缓存（key = `kind:style`，多个标记共用，释放时不可 dispose） */
  private markerTextures = new Map<string, THREE.Texture>();
  /** 「去过」标记当前样式：设置面板可切换（旗子 / 图钉 / 打卡章 / 脚印） */
  private visitedStyle: VisitedStyle = 'flag';
  private cities = new Map<string, PlateRecord>();
  private districts = new Map<string, PlateRecord>();
  private pins = new Map<string, PinRecord>();
  /** 区县 id → 该区县的光点：板块抬升时同步顶起光点，避免被埋进板里 */
  private pinsByDistrict = new Map<string, PinRecord[]>();
  private regionBox = new THREE.Box3();
  /**
   * 「老家视图」包围盒：全国化之后 regionBox 是整个中国（369 城），
   * 照它取景会把地图缩成一小条、观感很空。首屏 / 重置视角都按江浙沪皖这块
   * 取景（与全国化之前的四省视图一致），用户拖动或缩放即可去看其他省份。
   */
  private homeBox = new THREE.Box3();
  private stars: THREE.Points | null = null;
  private ground: THREE.Mesh | null = null;
  private grid: THREE.GridHelper | null = null;
  /** 环境贴图由 PMREM 渲染到一张 RenderTarget 上，只取 texture 引用会漏掉这张 RT */
  private envRT: THREE.WebGLRenderTarget | null = null;
  private labelRenderer: CSS2DRenderer;
  private provinceLabelGroup = new THREE.Group();
  private districtLabelGroup = new THREE.Group();
  private provinceLabels: CSS2DObject[] = [];
  private districtLabels: CSS2DObject[] = [];
  private districtLabelById = new Map<string, CSS2DObject>();
  private anchorGroup = new THREE.Group();
  private anchor: CSS2DObject | null = null;
  private anchorNdc = new THREE.Vector3();
  /** 地形图层（山地 / 湖泊 / 江河）：省视角满比例，下钻区县时压扁成「地貌底图」 */
  private terrain: TerrainHandle | null = null;
  private terrainOn = true;
  /** 天气特效层：地图空中的雨雪粒子 + 天色氛围，由当前可见层驱动 */
  private weatherFX: WeatherFX | null = null;
  private sun!: THREE.DirectionalLight;
  private weatherOn = true;
  private weatherAgg: WeatherKind | null = null;
  /** 主方向光基准亮度（setWeatherAmbience 据此调暗阴雨）；与 setupLights 里的初值保持一致 */
  private readonly weatherBaseDir = 2.4;
  /** 雾基准浓度（同 constructor 里 FogExp2 的初值） */
  private readonly weatherBaseFog = 0.0018;
  /** 城市多边形（世界坐标）：地形底板要用它铺一层低地色补上海岸线的网格空隙 */
  private cityShapes: ProjectedShape[] = [];
  /** 当前下钻城市的区县多边形：用来反算「不戳穿区县板块」的地形竖向缩放 */
  private districtShapes: ProjectedShape[] = [];
  private districtRelief = 1;
  /**
   * 城市边界线的原始环（世界 x / north 坐标）。
   * 板块自带的轮廓线贴在板顶 y=2.62，一旦盖上地形就被山体与平原整个埋掉，
   * 于是「城市之间的分隔」消失。这里另存一份，按地形高度逐段取样后重新画一遍。
   */
  private cityRings: Array<{ ring: [number, number][]; color: number }> = [];
  private boundaryOverlay: LineSegments2 | null = null;
  private boundaryMaterial: LineMaterial | null = null;
  private layer: 'city' | 'district' = 'city';
  /** 城市视图聚焦：进入城市后其余城市板块压暗为背景 */
  private focusedCityId: string | null = null;
  private hoveredKey: string | null = null;
  private selectedDistrictId: string | null = null;
  private focusedSpotId: string | null = null;
  private fly: {
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    t: number;
    duration: number;
  } | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private container: HTMLElement | null = null;
  private raf = 0;
  private lastT = 0;
  private paused = false;
  /** 最近一次 frameTo 的诊断信息（回归脚本用） */
  lastFrame: { sx: number; sz: number; dist: number } | null = null;
  /** 最近一次取景的包围盒：screenExtent 按它投影，才能核对城市 / 区县级的取景 */
  private framedBox: THREE.Box3 | null = null;

  /** 临时诊断：相机与包围盒的真实状态 */
  debugCamera(): unknown {
    const el = this.renderer.domElement;
    const tl = this.controls.target.clone();
    return {
      pos: this.camera.position.toArray().map((v) => +v.toFixed(2)),
      target: tl.toArray().map((v) => +v.toFixed(2)),
      dist: +this.camera.position.distanceTo(tl).toFixed(2),
      fov: this.camera.fov,
      aspect: +this.camera.aspect.toFixed(4),
      elAspect: +(((el?.clientWidth || 1) / (el?.clientHeight || 1)) as number).toFixed(4),
      box: {
        x: [+this.regionBox.min.x.toFixed(2), +this.regionBox.max.x.toFixed(2)],
        y: [+this.regionBox.min.y.toFixed(2), +this.regionBox.max.y.toFixed(2)],
        z: [+this.regionBox.min.z.toFixed(2), +this.regionBox.max.z.toFixed(2)],
      },
      home: {
        x: [+this.homeBox.min.x.toFixed(2), +this.homeBox.max.x.toFixed(2)],
        y: [+this.homeBox.min.y.toFixed(2), +this.homeBox.max.y.toFixed(2)],
        z: [+this.homeBox.min.z.toFixed(2), +this.homeBox.max.z.toFixed(2)],
      },
      lastFrame: this.lastFrame,
      panel: { side: this.sidePanelOpen, frac: this.panelFrac },
      flying: Boolean(this.fly),
    };
  }

  /** 用当前相机把区域包围盒的地面 4 角投影到屏幕，返回 CSS 像素包围盒。
   *  回归脚本靠它判断「地图是否真的完整落在可用区里」——比拿世界尺寸乘一个
   *  粗略的 px/单位 准得多（俯视 50° + 透视会同时压缩远端、放大近端）。 */
  screenExtent(): { x0: number; y0: number; x1: number; y1: number } | null {
    const el = this.renderer.domElement;
    if (!el) return null;
    const box = this.framedBox ?? this.regionBox;
    if (box.isEmpty()) return null;
    const W = el.clientWidth || 1;
    const H = el.clientHeight || 1;
    const cam = this.camera.clone() as THREE.PerspectiveCamera;
    cam.aspect = W / H;
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const cx of [box.min.x, box.max.x])
      for (const cz of [box.min.z, box.max.z]) {
        const q = new THREE.Vector3(cx, box.min.y, cz).project(cam);
        const px = (q.x * 0.5 + 0.5) * W;
        const py = (-q.y * 0.5 + 0.5) * H;
        x0 = Math.min(x0, px);
        x1 = Math.max(x1, px);
        y0 = Math.min(y0, py);
        y1 = Math.max(y1, py);
      }
    return { x0: +x0.toFixed(1), y0: +y0.toFixed(1), x1: +x1.toFixed(1), y1: +y1.toFixed(1) };
  }

  /**
   * 临时诊断：量每个标记「底边」与它脚下地表的屏幕间距（px，正数 = 悬空）。
   * 标记是 Sprite（center=(0.5,0)，底边对齐 position.y），所以
   * 世界底边 = 标记组.position.y + marker.position.y；地表取板块顶面（含抬升），
   * 开地形时再取地形表面。两个都投影到屏幕，差值就是肉眼看到的「悬空」。
   */
  markerProbe(): unknown[] {
    const el = this.renderer.domElement;
    if (!el) return [];
    const W = el.clientWidth || 1;
    const H = el.clientHeight || 1;
    const cam = this.camera.clone() as THREE.PerspectiveCamera;
    cam.aspect = W / H;
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const sy = (x: number, y: number, z: number) =>
      (-new THREE.Vector3(x, y, z).project(cam).y * 0.5 + 0.5) * H;
    const out: unknown[] = [];
    const layers: [THREE.Group, Map<string, PlateRecord>, THREE.Group][] = [
      [this.cityMarkerGroup, this.cities, this.cityGroup],
      [this.districtMarkerGroup, this.districts, this.districtGroup],
    ];
    for (const [group, map, plateGroup] of layers) {
      if (!group.visible) continue;
      for (const m of group.children) {
        const rec = map.get(m.userData.plateId as string);
        if (!rec) continue;
        const wx = m.position.x;
        const wz = m.position.z;
        const bottomWorld = group.position.y + m.position.y;
        const lift = rec.meshes[0].position.y;
        const plateTop = plateGroup.position.y + lift + rec.height;
        const terrainY =
          this.terrain && this.terrainOn ? this.terrain.heightAt(wx, wz) : plateTop;
        // 肉眼看到的地表 = 板顶与地形里更高的那个
        const surfaceY = Math.max(plateTop, terrainY);
        // 脚下到底有没有实体：从底边垂直向下打一条射线，看多远能碰到板块。
        // 标记若被错开到了板块之外（悬在背景上），这里就是 null。
        const rc = new THREE.Raycaster(
          new THREE.Vector3(wx, bottomWorld + 0.02, wz),
          new THREE.Vector3(0, -1, 0),
          0,
          6,
        );
        // 只打板块本体（Mesh）：轮廓线是 Line2，它的 raycast 依赖 material.resolution，
        // 探针里没设会抛错
        const meshes: THREE.Object3D[] = [];
        for (const r of this.cities.values()) meshes.push(...r.meshes);
        for (const r of this.districts.values()) meshes.push(...r.meshes);
        const hits = rc.intersectObjects(meshes, false);
        const hit = hits.length ? +hits[0].distance.toFixed(3) : null;
        out.push({
          id: m.userData.plateId,
          kind: m.userData.kind,
          layer: this.layer,
          bottomWorld: +bottomWorld.toFixed(3),
          plateTop: +plateTop.toFixed(3),
          terrainY: +terrainY.toFixed(3),
          gapPlatePx: +(sy(wx, plateTop, wz) - sy(wx, bottomWorld, wz)).toFixed(1),
          gapTerrainPx: +(sy(wx, terrainY, wz) - sy(wx, bottomWorld, wz)).toFixed(1),
          gapSurfacePx: +(sy(wx, surfaceY, wz) - sy(wx, bottomWorld, wz)).toFixed(1),
          downHit: hit,
          sx: Math.round((new THREE.Vector3(wx, bottomWorld, wz).project(cam).x * 0.5 + 0.5) * W),
          sy: Math.round(sy(wx, bottomWorld, wz)),
        });
      }
    }
    return out;
  }
  private downXY: [number, number] | null = null;
  /** 移动端底部详情面板占视口高度的比例：>0 时取景在窄屏预留底部空间，
   *  让选中的市 / 区县落在屏幕上半部分（不被半屏面板盖住）。桌面与无面板时为 0。 */
  private panelFrac = 0;
  /** 桌面端右侧详情面板（城市面板 / 区县抽屉）是否打开：只有打开时才为它留位。
   *  之前无论开没开都扣掉 372px，导致刚启动时整幅地图被压在中间一小块（用户反馈「太小」）。 */
  private sidePanelOpen = false;

  onPick?: (info: PickInfo) => void;
  onHover?: (info: { id: string; name: string; province?: string; kind: string } | null) => void;
  onAnchorClick?: (districtId: string) => void;

  /** 设置移动端底部面板是否展开：展开时（仅窄屏）预留面板高度，
   *  让选中的市 / 区县框进屏幕上半部分；收起 / 桌面时复位。 */
  setPanelExpanded(open: boolean): void {
    // 0.62 略大于面板实际高度（60vh），在面板顶缘上方留出一点空隙
    this.panelFrac = open && this.isNarrowViewport() ? 0.62 : 0;
  }

  /**
   * 桌面端右侧面板开合：取景时按「面板是否真的在」决定要不要让出右侧 372px。
   * 下钻城市 / 打开区县抽屉时置 true，回到总览时置 false。
   */
  setSidePanel(open: boolean): void {
    this.sidePanelOpen = open;
  }

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    // 移动端 GPU 填充率有限，像素比封顶 1.5（桌面 2），避免大屏手机掉帧
    const coarse =
      typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarse ? 1.5 : 2));
    // 触屏上让 OrbitControls 独占手势，避免页面滚动抢走拖动
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    // 上下文丢失（如打开 3D 照片墙时 GPU 资源紧张）时阻止默认行为，
    // 让浏览器在资源释放后主动恢复；three 内部会在 restored 时重建 GL 状态。
    const glCanvas = this.renderer.domElement;
    glCanvas.addEventListener(
      'webglcontextlost',
      (e) => {
        e.preventDefault();
      },
      false,
    );
    glCanvas.addEventListener('webglcontextrestored', () => this.resize(), false);

    this.scene.background = new THREE.Color('#05070d');
    this.scene.fog = new THREE.FogExp2('#05070d', 0.0018);

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 4000);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minPolarAngle = (20 * Math.PI) / 180;
    this.controls.maxPolarAngle = (78 * Math.PI) / 180;
    this.controls.rotateSpeed = 0.7;
    this.controls.panSpeed = 0.7;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // 泛光：原来 strength 0.2 / threshold 0.9 几乎不触发（只有接近纯白才发光），
    // 板块顶面有了清漆高光后需要让高光溢出来才有「炫」的感觉，
    // 但 threshold 不能太低，否则区县边界描边会糊成一团、可读性下降。
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.7, 0.62);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.labelRenderer = new CSS2DRenderer();
    const labelEl = this.labelRenderer.domElement;
    labelEl.style.position = 'absolute';
    labelEl.style.top = '0';
    labelEl.style.left = '0';
    labelEl.style.pointerEvents = 'none';

    this.setupLights();
    this.setupEnvironment();
    this.setupGround();
    this.setupStars();
    this.weatherFX = new WeatherFX(this.scene);
    this.scene.add(
      this.cityGroup,
      this.districtGroup,
      this.pinGroup,
      this.cityMarkerGroup,
      this.districtMarkerGroup,
      this.provinceLabelGroup,
      this.districtLabelGroup,
      this.anchorGroup,
    );
    this.districtLabelGroup.visible = false;
    this.districtMarkerGroup.visible = false;
  }

  mount(container: HTMLElement): void {
    this.container = container;
    (window as unknown as Record<string, unknown>).__sandboxScene = this;
    const canvas = this.renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    container.appendChild(canvas);
    container.appendChild(this.labelRenderer.domElement);

    this.resize();
    container.addEventListener('pointermove', this.onPointerMove);
    container.addEventListener('pointerdown', this.onPointerDown);
    container.addEventListener('click', this.onClick);
    window.addEventListener('resize', this.resize);
    this.raf = requestAnimationFrame(this.tick);
  }

  /** 暂停 / 恢复主渲染循环。
   *  打开照片墙（尤其 3D 展厅）时暂停主场景渲染，避免主场景与展厅双 WebGL 上下文
   *  同时高负载渲染导致主上下文被浏览器回收而回退白屏；关闭后恢复。 */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else {
      this.lastT = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    if (this.container) {
      this.container.removeEventListener('pointermove', this.onPointerMove);
      this.container.removeEventListener('pointerdown', this.onPointerDown);
      this.container.removeEventListener('click', this.onClick);
    }
    window.removeEventListener('resize', this.resize);
    const canvas = this.renderer.domElement;
    if (canvas.parentElement === this.container) canvas.remove();
    this.clearLayer(this.cityGroup, this.cities);
    this.clearLayer(this.districtGroup, this.districts);
    this.clearPins();
    this.clearMarkers(this.cityMarkerGroup);
    this.clearMarkers(this.districtMarkerGroup);
    for (const tex of this.markerTextures.values()) tex.dispose();
    this.markerTextures.clear();
    if (this.terrain) {
      this.scene.remove(this.terrain.group);
      this.terrain.dispose();
      this.terrain = null;
    }
    if (this.weatherFX) {
      this.weatherFX.dispose();
      this.weatherFX = null;
    }
    if (this.sun) this.sun.intensity = this.weatherBaseDir;
    if (this.scene.fog) (this.scene.fog as THREE.FogExp2).density = this.weatherBaseFog;
    // 贴地边界线不在任何 group 里（直接挂在 scene），要单独回收
    if (this.boundaryOverlay) {
      this.scene.remove(this.boundaryOverlay);
      this.disposeObject(this.boundaryOverlay);
      this.boundaryOverlay = null;
      this.boundaryMaterial = null;
    }
    this.disposeObject(this.stars);
    this.disposeObject(this.ground);
    this.disposeObject(this.grid);
    this.grid = null;
    // 后处理管线持有 7 张以上全屏 RenderTarget，不释放的话每次重建（HMR / StrictMode
    // 双挂载 / 反复开关）都会漏一整套，显存单调增长最终触发 WebGL 上下文丢失而白屏。
    this.bloomPass.dispose();
    this.composer.dispose();
    if (this.envRT) {
      this.envRT.dispose();
      this.envRT = null;
    }
    if (this.scene.environment) {
      this.scene.environment.dispose();
      this.scene.environment = null;
    }
    this.controls.dispose();
    this.clearLabels(this.provinceLabels, this.provinceLabelGroup);
    this.clearLabels(this.districtLabels, this.districtLabelGroup);
    this.setAnchor(null);
    disposePinGeometries();
    this.labelRenderer.domElement.remove();
    this.renderer.dispose();
  }

  setCityPlates(shapes: ProjectedShape[]): void {
    this.clearLayer(this.cityGroup, this.cities);
    this.cityRings = [];
    this.cityShapes = shapes;
    // 地形底板：城市多边形铺的低地色平面，补上海岸线处的网格空隙
    this.terrain?.setLandBase(shapes);
    for (const s of shapes) this.addPlate(this.cityGroup, this.cities, s, 'city', CITY_HEIGHT);
    this.regionBox = new THREE.Box3().setFromObject(this.cityGroup);
    const size = this.regionBox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.z);
    this.controls.minDistance = maxDim * 0.05;
    this.controls.maxDistance = maxDim * 4;
    // 老家视图（江浙沪皖）：从城市板块里挑出这四省求包围盒。
    // 取不到（比如内容被裁掉）就退回整幅中国，保证不会取到空盒导致首屏不取景。
    this.homeBox = this.boxOfProvinces(shapes, HOME_PROVINCES) ?? this.regionBox.clone();
    this.fitGroundToRegion(this.regionBox);
    this.updateProvinceLabels(shapes);
    // 窄屏（手机）首屏取景：用户要求「地图撑满屏幕、不需要全部看见」。
    // 区域图（约 102×120，宽高比 0.85）在竖屏手机上若按 contain 取景只能占屏高约 4 成，
    // 上下大片留白。这里用 0.59 的收紧系数把地图放到约屏高 55%（宽方向每边裁一些，
    // 只切到舟山一角，沪宁杭甬苏温都在屏内）；与 resetView 的窄屏系数保持一致。
    // 0.59 是「取景改按真实投影计算」之后回标的值：同样 0.55 在新算法下会多放大约 8%，
    // 上海市标签被顶到右边缘（x≈378 / 屏宽 390），所以回退到 0.59 保持原观感。
    // 桌面端首屏：区域图（102×120，竖长）在横屏上是**高度**先撑满。
    // 0.96 = 贴着可用区取景后再压 4%（用户反馈「视角还是想再拉近一点」）：
    // 江浙沪皖的极边（苏北一角、浙南一角、安徽西缘）允许各被裁掉约 1 屏的 2%，
    // 换整幅地图再大 4%。这是「撑满」与「全部进屏」之间取的折中，手机端同理。
    const initialFactor = this.isNarrowViewport() ? 0.59 : 0.96;
    this.frameTo(this.homeBox, 0, initialFactor, 0, this.usableView());
    this.updateLineResolutions();
    this.applyTerrain();
  }

  /** 求「指定省份」那批城市板块的包围盒；一个都没有时返回 null */
  private boxOfProvinces(shapes: ProjectedShape[], provinces: readonly string[]): THREE.Box3 | null {
    const want = new Set(provinces);
    const box = new THREE.Box3();
    let hit = 0;
    for (const s of shapes) {
      if (!s.province || !want.has(s.province)) continue;
      const rec = this.cities.get(s.id);
      if (!rec) continue;
      for (const mesh of rec.meshes) box.expandByObject(mesh);
      hit++;
    }
    return hit > 0 && !box.isEmpty() ? box : null;
  }

  setDistrictPlates(shapes: ProjectedShape[]): void {
    this.clearLayer(this.districtGroup, this.districts);
    this.clearPins();
    // 区县层整体抬到城市板顶面之上：板块 / 光点 / 标记 / 标签 / 卡锚同组一起抬，
    // 拾取与相机构图都用世界坐标，不受影响。
    this.setDistrictLayerY(DISTRICT_BASE_Y);
    this.districtShapes = shapes;
    this.districtRelief = this.terrain
      ? this.terrain.reliefForTop(shapes, DISTRICT_BASE_Y + DISTRICT_HEIGHT)
      : 1;
    for (const s of shapes) this.addPlate(this.districtGroup, this.districts, s, 'district', DISTRICT_HEIGHT);
    this.updateDistrictLabels(shapes);
    this.layer = 'district';
    this.provinceLabelGroup.visible = false;
    this.districtLabelGroup.visible = true;
    this.fitGroundToRegion(new THREE.Box3().setFromObject(this.districtGroup));
    // 按「可用视区」取景：城市整座带余量落在面板之间的空档里，而不是怼满整屏
    this.frameTo(new THREE.Box3().setFromObject(this.districtGroup), 0.7, 1.06, 0, this.usableView());
    this.hoveredKey = null;
    this.setHover(null);
    this.refreshStyles();
    this.updateLineResolutions();
    this.applyTerrain();
  }

  /** 区县层（板块 / 光点 / 标记 / 标签 / 卡锚）统一抬升，避免被城市板块压住 */
  private setDistrictLayerY(y: number): void {
    this.districtGroup.position.y = y;
    this.pinGroup.position.y = y;
    this.districtMarkerGroup.position.y = y;
    this.districtLabelGroup.position.y = y;
    this.anchorGroup.position.y = y;
  }

  /**
   * 让地面网格与光晕跟随当前区域尺寸：
   * 网格原本是 400×400 的固定大小，而江浙沪皖只有约 120 单位，
   * 溢出的网格线会在地图边缘（尤其南侧的安徽/上海下方）露出「多余的线」。
   * 这里按区域包围盒缩放到 1.5 倍，线条恰好收在地图外围一圈。
   */
  private fitGroundToRegion(box: THREE.Box3): void {
    if (box.isEmpty() || !this.grid || !this.ground) return;
    const size = box.getSize(new THREE.Vector3());
    // 网格按地图包围盒的长宽「分别」缩放，只留 3% 余量：
    // 用统一的 1.5 倍会在方块地图的长边方向伸出 30 个单位，
    // 在安徽/上海下方（海域）露出一圈多余网格线——正是用户反复提到的「多余的线」。
    const kx = (Math.max(size.x, 1) * 1.03) / 400;
    const kz = (Math.max(size.z, 1) * 1.03) / 400;
    this.grid.scale.set(kx, 1, kz);
    this.ground.scale.set(kx, 1, kz);
    const center = box.getCenter(new THREE.Vector3());
    this.grid.position.x = center.x;
    this.grid.position.z = center.z;
    this.ground.position.x = center.x;
    this.ground.position.z = center.z;
  }

  clearDistrictPlates(): void {
    this.clearLayer(this.districtGroup, this.districts);
    this.setDistrictLayerY(0);
    this.clearLabels(this.districtLabels, this.districtLabelGroup);
    this.clearPins();
    this.clearMarkers(this.districtMarkerGroup);
    // 回到省视角必须把城市标记显回来：
    // setCityFocus 在进城市时把 cityMarkerGroup 关掉，而 clearDistrictPlates 里
    // focusedCityId 已先被置空，setCityFocus(null) 会被早退挡掉 ——
    // 结果「去过/想去」的旗子和爱心在城市视图逛一圈后就再也不出现了。
    this.cityMarkerGroup.visible = true;
    this.districtMarkerGroup.visible = false;
    this.setAnchor(null);
    this.districtLabelGroup.visible = false;
    this.provinceLabelGroup.visible = true;
    this.layer = 'city';
    this.applyTerrain();
    this.selectedDistrictId = null;
    this.focusedSpotId = null;
    this.focusedCityId = null;
    this.setHover(null);
    this.refreshStyles();
    // 回退到省视角：把网格/地面缩放回「城市包围盒」，而不是残留的区县小盒，
    // 否则地图会缩成极小一块、四周发黑（用户反馈的 ESC 回退黑屏）。
    this.fitGroundToRegion(this.regionBox);
  }

  /** 城市视图聚焦：仅当前城市保持亮部，其余城市退为暗色背景；标记随层级切换 */
  setCityFocus(cityId: string | null): void {
    if (this.focusedCityId === cityId) return;
    this.focusedCityId = cityId;
    // 省视角：城市级标记（去过=红旗 / 收藏=粉心）
    // 城市视角：切到区县级标记，城市标记整体退场，避免浮在暗掉的背景城市上方
    this.cityMarkerGroup.visible = cityId === null;
    this.districtMarkerGroup.visible = cityId !== null;
    this.refreshStyles();
  }

  /** 重建景点 pin（筛选变化时整体重建，量级很小） */
  setPins(inputs: PinInput[]): void {
    this.clearPins();
    for (const input of inputs) {
      const rec = this.districts.get(input.districtId);
      const pin = createPin(input, (rec?.height ?? DISTRICT_HEIGHT) + 0.02);
      this.pinGroup.add(pin.group);
      this.pins.set(pin.id, pin);
      const list = this.pinsByDistrict.get(input.districtId);
      if (list) list.push(pin);
      else this.pinsByDistrict.set(input.districtId, [pin]);
    }
    this.refreshPinStyles();
  }

  selectDistrict(id: string | null): void {
    if (this.selectedDistrictId === id) return;
    this.selectedDistrictId = id;
    for (const [labelId, label] of this.districtLabelById) {
      label.visible = labelId !== id;
    }
    this.refreshStyles();
    this.refreshPinStyles();
  }

  focusSpot(id: string | null): void {
    this.focusedSpotId = id;
    this.refreshPinStyles();
  }

  focusDistrict(id: string): void {
    const rec = this.districts.get(id);
    if (!rec) return;
    // 多环区县（如淳安）要取所有碎岛的合集，否则只会框住其中一块
    const box = new THREE.Box3();
    for (const mesh of rec.meshes) box.expandByObject(mesh);
    if (!box.isEmpty())
      // 带「可用视区」取景：手机上底部有半屏面板时，区县会被框进上半部分，不被盖住
      this.frameTo(box, 0.6, 1.45, 12, this.usableView());
  }

  /** 回到全省总览：按当前可用视区取景，保证整幅地图完整进屏（手机竖屏尤其明显） */
  resetView(): void {
    const view = this.usableView();
    // 手机上留白余量收窄一点：既保证不出屏，又让地图尽量占满屏幕
    const el = this.renderer.domElement;
    const narrow = Boolean(el) && (el.clientWidth || 0) <= 820;
    // 与首屏取景一致：手机竖屏上「撑满屏幕」优先于「全部进屏」，
    // 宽方向每边裁一些（只切舟山一角），地图放到约屏高 55%。
    // 老家视图 = 江浙沪皖（不是整幅中国）：全国化后 regionBox 是 369 城，
    // 按它取景地图会缩成一小条；四省范围才是用户熟悉的总览视角，其他省份拖动去看。
    this.frameTo(this.homeBox, 0.7, narrow ? 0.59 : 0.96, 0, view);
  }

  /** 省视角城市标记：去过 = 小红旗，收藏 = 粉心 */
  setCityMarkers(items: { id: string; kind: MarkerKind }[]): void {
    this.fillMarkers(this.cityMarkerGroup, this.cities, items);
  }

  /** 城市视角区县标记：去过 = 小红旗，收藏 = 粉心 */
  setDistrictMarkers(items: { id: string; kind: MarkerKind }[]): void {
    this.fillMarkers(this.districtMarkerGroup, this.districts, items);
  }

  /** 挂载地形图层（水体 / 江河 / 山脉），复用 scene 当前投影 */
  setTerrain(handle: TerrainHandle | null): void {
    if (this.terrain) {
      this.scene.remove(this.terrain.group);
      this.terrain.dispose();
    }
    this.terrain = handle;
    if (handle) {
      this.scene.add(handle.group);
      if (this.cityShapes.length > 0) handle.setLandBase(this.cityShapes);
      // 地形异步到达时可能已经在下钻状态：补算一次缩放，否则山体会戳穿区县板块
      if (this.layer === 'district' && this.districtShapes.length > 0) {
        this.districtRelief = handle.reliefForTop(
          this.districtShapes,
          DISTRICT_BASE_Y + DISTRICT_HEIGHT,
        );
      }
      const w = this.container?.clientWidth ?? 0;
      const h = this.container?.clientHeight ?? 0;
      if (w > 0 && h > 0) handle.setResolution(w, h);
      this.applyTerrain();
    }
  }

  /** 用户开关：是否显示地形 */
  setTerrainVisible(on: boolean): void {
    this.terrainOn = on;
    this.applyTerrain();
  }

  /**
   * 天气图层：把当前可见层各区域的天气画到天上。
   * items 来自天气 store 的缓存（liveWeatherKind，优先 current 实时观测），id 与板块一致，
   * 这里从板块包围盒反算投放范围（质心 + 半幅 + 抬升后的顶面高度）。
   */
  setWeather(items: { id: string; kind: WeatherKind }[]): void {
    if (!this.weatherFX) return;
    const map = this.layer === 'district' ? this.districts : this.cities;
    const baseY = this.layer === 'district' ? DISTRICT_BASE_Y : 0;
    const regions = items
      .map((it) => {
        // 省视角的天气 key 是 `city:<id>`（与城市详情面板共用一份缓存），
        // 而城市板块在场景里的 key 是纯 id —— 两边对不上就会整层不下雨，这里剥掉前缀。
        const key = it.id.startsWith('city:') ? it.id.slice(5) : it.id;
        const rec = map.get(key);
        if (!rec) return null;
        const box = new THREE.Box3();
        for (const m of rec.meshes) box.expandByObject(m);
        const size = box.getSize(new THREE.Vector3());
        const radius = Math.max(size.x, size.z) * 0.55;
        return {
          id: it.id,
          kind: it.kind,
          x: rec.centroid[0],
          z: -rec.centroid[1],
          radius,
          topY: baseY + rec.height + 0.2,
          height: 9,
        };
      })
      .filter(Boolean) as {
      id: string;
      kind: WeatherKind;
      x: number;
      z: number;
      radius: number;
      topY: number;
      height: number;
    }[];
    this.weatherFX.setRegions(regions);
  }

  /**
   * 全局天色：按当前各区域天气综合出一档明暗 / 雾浓度。
   * 取「最严重的那类」作为氛围（雪 / 雨 > 雾 > 阴 > 多云 > 晴），
   * 阴雨时整体压暗、加雾，晴天略提亮 —— 这是「氛围」不是逐格预报。
   */
  setWeatherAmbience(kind: WeatherKind | null): void {
    this.weatherAgg = kind;
    if (!this.sun) return;
    const dir = this.weatherBaseDir;
    const fog = this.weatherBaseFog;
    const presets: Record<WeatherKind, { dir: number; fog: number }> = {
      sunny: { dir: dir * 1.08, fog: fog * 0.85 },
      cloudy: { dir: dir * 0.85, fog: fog * 1.1 },
      overcast: { dir: dir * 0.55, fog: fog * 1.6 },
      fog: { dir: dir * 0.5, fog: fog * 2.6 },
      rain: { dir: dir * 0.5, fog: fog * 2.0 },
      snow: { dir: dir * 0.7, fog: fog * 1.5 },
    };
    const p = kind ? presets[kind] : { dir, fog };
    this.sun.intensity = p.dir;
    if (this.scene.fog) (this.scene.fog as THREE.FogExp2).density = p.fog;
  }

  /** 用户开关：天气图层是否显示（含天色氛围） */
  setWeatherVisible(on: boolean): void {
    this.weatherOn = on;
    this.weatherFX?.setVisible(on);
    this.setWeatherAmbience(on ? this.weatherAgg : null);
  }

  /**
   * 地形在两个层级都显示，但比例不同：
   * - 省视角：满比例（真实高程 × 夸张倍数），山川湖海是主视觉；
   * - 区县视角：压到 0.12 —— 区县板块层固定在 y≈3.6，满比例的山会从天里长出来、把区县戳穿。
   *   压扁后地形读作「板块下方的地貌底图」，颜色仍按真实海拔着色，远看还是能认出山区和平原。
   * 城市边界线只在省视角画：区县视角用的是板块自带的区县轮廓。
   */
  private applyTerrain(): void {
    const on = Boolean(this.terrain && this.terrainOn);
    if (this.terrain) {
      this.terrain.group.visible = on;
      this.terrain.setRelief(this.layer === 'district' ? this.districtRelief : 1);
    }
    // 边界线两个层级都画：区县视角里周边城市也要能读出形状，
    // 否则地形一铺，周围就剩一整片没有分界的绿。取样用 heightAt，压扁后同样贴地。
    this.rebuildBoundaryOverlay(on);
    this.applyMarkerGround();
  }

  /**
   * 重建「贴地城市边界线」。
   * 地形把板块顶盖连同它的轮廓线一起盖住了，城市的形状只能靠这条线读出来：
   * 逐点问地形要高度（heightAt），沿线每 ~3.7km 打一个采样点，整条线贴着山形起伏，
   * 所有城市合并成一次绘制，桌面 / 安卓都只多 1 个 draw call。
   */
  private rebuildBoundaryOverlay(show: boolean): void {
    if (this.boundaryOverlay) {
      this.scene.remove(this.boundaryOverlay);
      this.disposeObject(this.boundaryOverlay);
      this.boundaryOverlay = null;
      this.boundaryMaterial = null;
    }
    if (!show || !this.terrain || this.cityRings.length === 0) return;

    const positions: number[] = [];
    const colors: number[] = [];
    const col = new THREE.Color();
    /** 采样步长（世界单位）：江浙沪皖约 900km / 120 单位，0.5 ≈ 3.7km */
    const STEP = 0.5;
    /** 抬离地表的量：高过湖面（0.08）与河道（0.16），又不至于浮空 */
    const LIFT = 0.26;
    const t = this.terrain;

    for (const item of this.cityRings) {
      col.setHex(item.color);
      const ring = item.ring;
      const n = ring.length;
      if (n < 3) continue;
      for (let i = 0; i < n; i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[(i + 1) % n];
        // 投影后的 y 是「北」，世界 z = -y（与投影一致）
        const z1 = -y1;
        const z2 = -y2;
        const dx = x2 - x1;
        const dz = z2 - z1;
        const len = Math.hypot(dx, dz);
        if (len < 1e-6) continue;
        const steps = Math.max(1, Math.ceil(len / STEP));
        for (let s = 0; s < steps; s++) {
          const t0 = s / steps;
          const t1 = (s + 1) / steps;
          const ax = x1 + dx * t0;
          const az = z1 + dz * t0;
          const bx = x1 + dx * t1;
          const bz = z1 + dz * t1;
          positions.push(ax, t.heightAt(ax, az) + LIFT, az, bx, t.heightAt(bx, bz) + LIFT, bz);
          colors.push(col.r, col.g, col.b, col.r, col.g, col.b);
        }
      }
    }
    if (positions.length < 6) return;

    const geo = new LineSegmentsGeometry();
    geo.setPositions(positions);
    geo.setColors(colors);
    const mat = new LineMaterial({
      vertexColors: true,
      linewidth: this.isNarrowViewport() ? 1.4 : 2.4,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const w = this.container?.clientWidth ?? 0;
    const h = this.container?.clientHeight ?? 0;
    if (w > 0 && h > 0) mat.resolution.set(w, h);
    const overlay = new LineSegments2(geo, mat);
    overlay.computeLineDistances();
    // 和板块轮廓线一样：包围球由实例几何推导，斜视角容易被误剔除
    overlay.frustumCulled = false;
    overlay.renderOrder = 6;
    this.scene.add(overlay);
    this.boundaryOverlay = overlay;
    this.boundaryMaterial = mat;
  }

  private isNarrowViewport(): boolean {
    return this.container ? this.container.clientWidth <= 820 : false;
  }

  private fillMarkers(
    group: THREE.Group,
    records: Map<string, PlateRecord>,
    items: { id: string; kind: MarkerKind }[],
  ): void {
    for (const marker of [...group.children]) {
      group.remove(marker);
      this.disposeObject(marker);
    }
    // 同一地点可能同时有多个标记（收藏 + 去过）。若都放在质心，
    // 既会互相重叠，又会被质心处的区县名标签（DOM 药丸）整个挡住——
    // 这正是用户反馈「收藏/去过标记看不见」的根因。这里按槽位错开摆位。
    const seen = new Map<string, number>();
    for (const item of items) {
      const rec = records.get(item.id);
      if (!rec) continue;
      const obj = this.createMarker(item.kind);
      obj.userData.kind = item.kind;
      const slot = seen.get(item.id) ?? 0;
      seen.set(item.id, slot + 1);
      const ang = -Math.PI / 2 + slot * (Math.PI * 0.66);
      const ox = Math.cos(ang);
      const oz = Math.sin(ang);
      // 地形盖在板块之上：旗子 / 爱心要插在「地表」而不是板顶，
      // 否则山地里的标记会被山体埋掉一半（用户反馈「有了地形之后红旗和爱心看不见」）。
      const cx = rec.centroid[0];
      const cz = -rec.centroid[1];
      // 只抬 0.03（约 0.2~1px）：贴片本来就关了深度测试，抬多了就是肉眼可见的「悬空」
      const baseY = this.markerGroundY(cx + ox, cz + oz, rec.height, this.layerBase(group)) + 0.03;
      obj.position.set(cx + ox, baseY, cz + oz);
      obj.userData.baseY = baseY;
      obj.userData.plateId = item.id;
      // 锚点与单位方向：错开距离随标记自身缩放走，
      // 否则远距离时标记变大（恒定屏幕尺寸）而间距不变，两个标记会叠在一起。
      obj.userData.anchorX = rec.centroid[0];
      obj.userData.anchorZ = -rec.centroid[1];
      obj.userData.offX = ox;
      obj.userData.offZ = oz;
      group.add(obj);
    }
  }

  /**
   * 标记落点的地表高度，**单位是「标记所在组」的局部坐标**。
   *
   * 关键：地形 `heightAt` 给的是绝对世界高度（地表基准 2.68 起算），而
   * `plateTop` 是板块的局部厚度（城市 2.6 / 区县 1.0）。省视角标记组 y=0，
   * 两者恰好重合，看不出问题；区县视角标记组被整体抬到 DISTRICT_BASE_Y（2.63），
   * 再直接加绝对地形高度就会**多抬一整个层高**——这就是「区县收藏的旗子 / 爱心
   * 悬空很高，回全局视角又正常」的根因。这里统一减掉层基准，两组坐标才对得上。
   */
  private markerGroundY(x: number, z: number, plateTop: number, layerBase: number): number {
    if (!this.terrain || !this.terrainOn) return plateTop;
    return Math.max(plateTop, this.terrain.heightAt(x, z) - layerBase);
  }

  /**
   * 地形挂载 / 开关 / 层级切换后，把已有标记重新插回地表。
   * 标记是「先建后挂地形」的（地形 500KB 异步加载），不补这一步，
   * 先建的旗子会停在板顶、被后到的山体埋住。
   */
  private applyMarkerGround(): void {
    for (const marker of this.cityMarkerGroup.children) {
      const rec = this.cities.get(marker.userData.plateId as string);
      if (!rec) continue;
      const x = marker.userData.anchorX as number;
      const z = marker.userData.anchorZ as number;
      const off = marker.userData.offX as number;
      const offZ = marker.userData.offZ as number;
      marker.userData.baseY =
        this.markerGroundY(x + off, z + offZ, rec.height, this.layerBase(this.cityMarkerGroup)) +
        0.03;
    }
    for (const marker of this.districtMarkerGroup.children) {
      const rec = this.districts.get(marker.userData.plateId as string);
      if (!rec) continue;
      const x = marker.userData.anchorX as number;
      const z = marker.userData.anchorZ as number;
      const off = marker.userData.offX as number;
      const offZ = marker.userData.offZ as number;
      marker.userData.baseY =
        this.markerGroundY(
          x + off,
          z + offZ,
          rec.height,
          this.layerBase(this.districtMarkerGroup),
        ) + 0.03;
    }
  }

  /** 标记组的层基准：区县层整体抬到 DISTRICT_BASE_Y，省视角为 0 */
  private layerBase(group: THREE.Group): number {
    return group === this.districtMarkerGroup ? DISTRICT_BASE_Y : 0;
  }

  /**
   * 标记贴片纹理：用 canvas 现画，避免多几份静态资源。
   *
   * 为什么不用 3D 几何：旗面是竖直平面、旗杆是竖直细杆，默认 50° 俯角看下去
   * 两者都接近正侧对镜头，屏幕上只剩一条红线——这就是「exe 里看不到小旗子和爱心」的原因。
   * Sprite 是屏幕对齐的公告板，任何角度都完整可见。
   *
   * 绘制细节全在 markerArt.ts：设置面板的样式预览复用它，保证「预览 = 实样」。
   */
  private markerTexture(kind: MarkerKind): THREE.Texture {
    // 去过标记按当前样式单独缓存：来回切换样式时不用重画，切回去直接命中
    const key = kind === 'visited' ? `visited:${this.visitedStyle}` : 'favorite';
    const cached = this.markerTextures.get(key);
    if (cached) return cached;

    const cv = document.createElement('canvas');
    cv.width = MARKER_W;
    cv.height = MARKER_H;
    const ctx = cv.getContext('2d')!;
    if (kind === 'visited') paintVisited(ctx, this.visitedStyle);
    else paintFavorite(ctx);

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    this.markerTextures.set(key, tex);
    return tex;
  }

  /**
   * 切换「去过」标记样式。已有的标记就地换贴图，不重建整组 ——
   * 重建会连带丢掉落点、槽位错开等 userData，还得重跑一次贴地计算。
   */
  setVisitedStyle(style: VisitedStyle): void {
    if (style === this.visitedStyle) return;
    this.visitedStyle = style;
    for (const group of [this.cityMarkerGroup, this.districtMarkerGroup]) {
      for (const marker of group.children) {
        if (marker.userData.kind !== 'visited') continue;
        const mat = (marker as THREE.Sprite).material as THREE.SpriteMaterial;
        mat.map = this.markerTexture('visited');
        mat.needsUpdate = true;
      }
    }
  }

  /** 创建贴片标记：底边对齐锚点，落在地表上 */
  private createMarker(kind: MarkerKind): THREE.Sprite {
    const mat = new THREE.SpriteMaterial({
      map: this.markerTexture(kind),
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    // 纹理是共享缓存，别在移除单个标记时把它 dispose 掉
    mat.userData.sharedTexture = true;
    const sp = new THREE.Sprite(mat);
    sp.center.set(0.5, 0);
    sp.renderOrder = 20;
    return sp;
  }

  setAnchor(info: AnchorInfo | null): void {
    if (this.anchor) {
      this.anchor.removeFromParent();
      this.anchor.element.remove();
      this.anchor = null;
    }
    if (!info) return;
    const rec = this.districts.get(info.id);
    if (!rec) return;

    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'map-anchor';
    el.innerHTML = `
      <span class="map-anchor__head">
        <span class="map-anchor__dot"></span>
        <span class="map-anchor__name">${info.name}</span>
        <span class="map-anchor__count">${info.spotCount} 处景点</span>
      </span>
      <span class="map-anchor__stem"></span>
    `;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onAnchorClick?.(info.id);
    });
    const obj = new CSS2DObject(el);
    obj.position.set(rec.centroid[0], rec.height + 0.15, -rec.centroid[1]);
    this.anchorGroup.add(obj);
    this.anchor = obj;
  }

  private clearMarkers(group: THREE.Group): void {
    for (const marker of [...group.children]) {
      group.remove(marker);
      this.disposeObject(marker);
    }
  }

  private clearPins(): void {
    for (const pin of this.pins.values()) {
      this.pinGroup.remove(pin.group);
      disposePin(pin);
    }
    this.pins.clear();
    this.pinsByDistrict.clear();
  }

  private clearLabels(list: CSS2DObject[], group: THREE.Group): void {
    for (const l of list) {
      l.removeFromParent();
      l.element.remove();
    }
    list.length = 0;
    group.clear();
  }

  private updateProvinceLabels(shapes: ProjectedShape[]): void {
    this.clearLabels(this.provinceLabels, this.provinceLabelGroup);
    const sums = new Map<string, { x: number; z: number; n: number }>();
    for (const s of shapes) {
      if (!s.province) continue;
      const acc = sums.get(s.province) ?? { x: 0, z: 0, n: 0 };
      acc.x += s.centroid[0];
      acc.z -= s.centroid[1];
      acc.n += 1;
      sums.set(s.province, acc);
    }
    for (const [name, acc] of sums) {
      if (acc.n === 0) continue;
      const el = document.createElement('div');
      el.className = 'geo-label';
      el.textContent = name;
      const obj = new CSS2DObject(el);
      // 标签贴在「城市板块顶面」而不是一个固定高度：
      // 原先写死 y=10，整幅中国取景（dist≈130）时看不出问题；全国化后首屏按江浙沪皖
      // 取景（dist≈17），10 个单位被透视放大，标签整排飞到屏幕上方看不见了。
      obj.position.set(acc.x / acc.n, CITY_HEIGHT + 0.05, acc.z / acc.n);
      this.provinceLabelGroup.add(obj);
      this.provinceLabels.push(obj);
    }
  }

  private updateDistrictLabels(shapes: ProjectedShape[]): void {
    this.clearLabels(this.districtLabels, this.districtLabelGroup);
    this.districtLabelById.clear();
    for (const s of shapes) {
      const el = document.createElement('div');
      el.className = `geo-label geo-label--district${s.indexed === false ? ' is-empty' : ''}`;
      el.textContent = s.name;
      const obj = new CSS2DObject(el);
      obj.position.set(s.centroid[0], (this.districts.get(s.id)?.height ?? DISTRICT_HEIGHT) + 0.05, -s.centroid[1]);
      this.districtLabelGroup.add(obj);
      this.districtLabels.push(obj);
      this.districtLabelById.set(s.id, obj);
    }
  }

  private addPlate(
    group: THREE.Group,
    map: Map<string, PlateRecord>,
    s: ProjectedShape,
    kind: 'city' | 'district',
    height: number,
  ): void {
    const province = s.province as Province | undefined;
    const provColor = province ? PROVINCE_COLOR[province] : 0x34d399;
    const indexed = s.indexed !== false;
    // 区域总览：已录入城市明显亮于待录入城市，形成「可下钻」的视觉引导
    const glowIntensity =
      kind === 'city' ? (indexed ? 0.24 : 0.035) : indexed ? 0.14 : 0.05;
    const sideGlow = kind === 'city' ? (indexed ? 0.08 : 0.015) : indexed ? 0.06 : 0.02;
    const edgeOpacity = kind === 'city' ? (indexed ? 0.95 : 0.2) : indexed ? 0.95 : 0.5;
    // 区县边界用「省份色提亮」的高对比浅色：同色描边在同色填充上几乎不可见，
    // 提亮到接近白后，相邻区县之间才有清晰的分界线（用户反复反馈的「没有线条区分」）。
    const edgeColor =
      kind === 'district'
        ? new THREE.Color(provColor).lerp(new THREE.Color(0xffffff), 0.5).getHex()
        : provColor;
    const style: PlateStyle = {
      height,
      capColor: indexed ? FACE_INDEXED : FACE_MUTED,
      sideColor: indexed ? SIDE_INDEXED : SIDE_MUTED,
      glowColor: provColor,
      edgeColor,
      glowIntensity,
      sideGlow,
      edgeOpacity,
    };
    // 城市层额外留一份轮廓给「贴地边界线」用：
    // 亮度必须压在 bloom 阈值（0.62）以下 —— 满图的城市线一旦泛光，
    // 会把整块地形冲成一片白光，什么都看不见。这里只提亮一点点，靠对比度而非发光取胜。
    if (kind === 'city') {
      // 提亮 + 略降饱和：浙江省的颜色本来就和地形绿色同族，
      // 直接用地形色画线会「线消失在填充里」，偏亮的薄荷色才拉得开层次。
      const ringColor = new THREE.Color(provColor).offsetHSL(0, -0.2, 0.18);
      ringColor.multiplyScalar(indexed ? 0.74 : 0.4);
      const ringsForOverlay = s.outlines && s.outlines.length > 0 ? s.outlines : [s.outline];
      for (const ring of ringsForOverlay) this.cityRings.push({ ring, color: ringColor.getHex() });
    }
    // 同一层级内所有板块统一厚度：不再按轮廓大小自适应。
    // 自适应深度会让大板块高、小板块薄，3D 视角下读作「地势」，
    // 靠前的厚板块还会挡住后面的薄板块，导致低地势的区县点不到。
    const rings = s.outlines && s.outlines.length > 0 ? s.outlines : [s.outline];
    const meshes: THREE.Mesh[] = [];
    const capMaterials: THREE.MeshStandardMaterial[] = [];
    const edgeMaterials: LineMaterial[] = [];
    const pedestals: THREE.Mesh[] = [];
    const depth = height;
    for (const ring of rings) {
      const mesh = createPlateMesh(ring, { ...style, height: depth }, {
        kind,
        id: s.id,
        name: s.name,
        province: s.province,
      });
      const materials = mesh.material as THREE.MeshStandardMaterial[];
      capMaterials.push(materials[CAP_MATERIAL_INDEX]);
      const edges = mesh.children[0] as Line2;
      edgeMaterials.push(edges.material as LineMaterial);
      meshes.push(mesh);
      group.add(mesh);
      // 基座柱：与板块同形内缩，从地面连到板底。
      // 板块落下时高度趋近 0（完全藏进板内），抬起时恰好填满悬空，
      // 让「抬升」读作展台而不是一块漂浮的平板。
      const pedestal = this.createPedestal(ring, s.centroid, provColor);
      pedestals.push(pedestal);
      group.add(pedestal);
    }
    const baseCapColor = capMaterials[0].color.getHex();
    // 聚焦时其余城市保留省份色相压暗（而不是抹成近黑剪影），
    // 轮廓线同步压暗，整体读作「退后」而不是「消失」。
    const mutedCapColor = new THREE.Color(baseCapColor).multiplyScalar(0.62).getHex();
    const mutedEdgeColor = new THREE.Color(provColor).multiplyScalar(0.5).getHex();
    map.set(s.id, {
      meshes,
      capMaterials,
      edgeMaterials,
      baseEdgeColor: edgeColor,
      baseCapColor,
      mutedCapColor,
      mutedEdgeColor,
      baseEmissive: provColor,
      baseIntensity: glowIntensity,
      baseEdgeOpacity: edgeOpacity,
      centroid: s.centroid,
      height: depth,
      lift: Math.min(1.2, depth * 0.45 + 0.25),
      pedestals,
      targetY: 0,
    });
  }

  /** 板块的抬升基座：同形内缩 + 单位高度，运行时按抬升量缩放 */
  private createPedestal(outline: [number, number][], centroid: [number, number], glow: number): THREE.Mesh {
    const inset = 0.84;
    const pts = outline.map(
      ([x, y]) => new THREE.Vector2(centroid[0] + (x - centroid[0]) * inset, centroid[1] + (y - centroid[1]) * inset),
    );
    const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 1, bevelEnabled: false });
    // 明显亮于板块侧壁与背景：单独看是一座暗色台子，托起板块后读作展台
    const mat = new THREE.MeshStandardMaterial({
      color: 0x22304a,
      roughness: 0.7,
      metalness: 0.2,
      emissive: glow,
      emissiveIntensity: 0.3,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    // 注意：rotation.x = -90° 后，「高度」是局部 Z 轴（挤出方向），局部 Y 变成世界 Z（南北）。
    // 早期写成 scale.y = 0.001 会把基座的南北向压扁 50 倍 → 变成一片贴在地图中央纬线上的薄墙，
    // 露出板块外就成了用户反复看到的那两段「横穿细线」。必须压 scale.z。
    mesh.scale.z = 0.001;
    // 轮廓线让基座在暗场里读得出「这是一座台子」，而不是一块浮空平板
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo, 24),
      new THREE.LineBasicMaterial({ color: glow, transparent: true, opacity: 0.6 }),
    );
    mesh.add(edges);
    return mesh;
  }

  private clearLayer(group: THREE.Group, map: Map<string, PlateRecord>): void {
    for (const rec of map.values()) {
      for (const pedestal of rec.pedestals) {
        group.remove(pedestal);
        this.disposeObject(pedestal);
      }
      for (const mesh of rec.meshes) {
        group.remove(mesh);
        this.disposeObject(mesh);
      }
    }
    map.clear();
    group.clear();
  }

  private disposeObject(obj: THREE.Object3D | null): void {
    if (!obj) return;
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      // Sprite 用的是 three 内部共享的几何体，单独 dispose 会把所有贴片一起弄坏
      if (mesh.geometry && !(o as THREE.Sprite).isSprite) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => this.disposeMaterial(m));
      else if (mat) this.disposeMaterial(mat);
    });
  }

  /** 材质上的贴图（地面/星空等 CanvasTexture）不会随 material.dispose 释放，必须显式回收 */
  private disposeMaterial(mat: THREE.Material): void {
    // 共享贴图（标记图标）只随 SceneManager 一起释放，单个标记移除时不能 dispose
    if (mat.userData?.sharedTexture) {
      mat.dispose();
      return;
    }
    const slots = ['map', 'alphaMap', 'emissiveMap', 'normalMap'] as const;
    for (const slot of slots) {
      const tex = (mat as unknown as Record<string, THREE.Texture | null>)[slot];
      if (tex && typeof tex.dispose === 'function') tex.dispose();
    }
    mat.dispose();
  }

  /**
   * 把包围盒框进相机视野。
   * `view` 是「可用视区」（像素，已排除左侧索引、右侧城市面板与上下 HUD）：
   * 默认取景只按整屏算，城市会被推到面板底下、看着「放得太大」；
   * 传入可用视区后，会按可用宽高反算距离，并把内容平移到可用区中心。
   */
  private frameTo(
    box: THREE.Box3,
    duration: number,
    factor = 1.3,
    minDist = 0,
    view?: { x: number; y: number; w: number; h: number },
  ): void {
    if (box.isEmpty()) return;
    this.framedBox = box.clone();
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.z);
    const fov = (this.camera.fov * Math.PI) / 180;
    const t = Math.tan(fov / 2);
    let dist = Math.max((maxDim / (2 * t)) * factor, minDist);

    // 竖屏（aspect < 1）时水平视野比垂直窄：只按 maxDim 取景会让内容左右溢出屏幕。
    // 手机上第一次打开「地图超出屏幕」就是这个原因，这里先补一档水平距离。
    const el = this.renderer.domElement;
    if (el) {
      const aspect = (el.clientWidth || 1) / (el.clientHeight || 1);
      if (aspect < 1) dist = Math.max(dist, (size.x / (2 * t * aspect)) * factor);
    }

    let offset: THREE.Vector3 | null = null;
    if (view && this.renderer.domElement) {
      const W = this.renderer.domElement.clientWidth || 1;
      const H = this.renderer.domElement.clientHeight || 1;
      const aspect = W / H;
      const fw = Math.max(view.w / W, 0.25);
      const fh = Math.max(view.h / H, 0.25);
      dist = Math.max(dist, (size.x / (2 * t * aspect * fw)) * factor, (size.z / (2 * t * fh)) * factor);

      // 透视修正：上式按「包围盒在目标平面上的投影」估算，但俯视（50°）时
      // 地块近端离相机更近、投影被放大，实际会怼出可用区、被左右面板压住。
      // 这里用一台探针相机真实投影一次包围盒 8 个角，按超出比例回退距离。
      const elev = (ELEV_DEG * Math.PI) / 180;
      const probe = this.camera.clone() as THREE.PerspectiveCamera;
      probe.aspect = aspect;
      // 只用「地面高度」的 4 个角：板块挤出高度只有几米，但 50° 斜视下远端顶角
      // 会投影到接近地平线的位置，把包围盒高度撑大一大截，导致相机被无谓地推远、
      // 地图缩成屏幕中间一小块（手机竖屏尤其明显）。地面 4 角才是真正要装进视野的范围。
      const corners: THREE.Vector3[] = [];
      for (const cx of [box.min.x, box.max.x])
        for (const cz of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(cx, box.min.y, cz));
      // 相机基向量：俯视方位角恒为 0（frameTo 每次都按标准机位重算），
      // 所以 right / up 可以直接解析给出。
      // 不能从 `camera.matrixWorld` 里取——首屏取景时它还没被渲染循环更新过，
      // 取到的是单位矩阵，up 被当成世界 +Y，平移就沿「竖直」方向走而不是沿屏幕纵向：
      // 整幅地图被推得偏离可用区中心，还因为顺带拉近了地面而被放大。
      const camRight = new THREE.Vector3(1, 0, 0);
      const camUp = new THREE.Vector3(0, Math.cos(elev), -Math.sin(elev));
      const _look = new THREE.Vector3();
      const _q = new THREE.Vector3();
      const _o = new THREE.Vector3();
      let off = new THREE.Vector3();

      /** 在给定距离 + 平移量下，用探针相机把地面 4 角投影成屏幕像素包围盒 */
      const projectBox = (d: number, o: THREE.Vector3) => {
        probe.position
          .set(center.x, center.y + Math.sin(elev) * d, center.z + Math.cos(elev) * d)
          .add(o);
        probe.lookAt(_look.copy(center).add(o));
        probe.updateMatrixWorld(true);
        probe.updateProjectionMatrix();
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const c of corners) {
          const q = _q.copy(c).project(probe);
          const px = (q.x * 0.5 + 0.5) * W;
          const py = (-q.y * 0.5 + 0.5) * H;
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
        return {
          cx: (minX + maxX) / 2,
          cy: (minY + maxY) / 2,
          w: Math.max(maxX - minX, 1),
          h: Math.max(maxY - minY, 1),
        };
      };

      /** 把投影包围盒中心对到可用区中心（牛顿步）。
       *  近端 / 远端的像素位移并不等于「请求的位移」—— 俯视下近端被放大，
       *  直接按残差平移会过冲、甚至来回震荡把整幅地图甩出屏幕，
       *  所以先用探针量出实际增益（每请求 1px 实际走多少 px）再决定这一步走多少。 */
      const recenter = (d: number, o: THREE.Vector3): THREE.Vector3 => {
        const wpp = (2 * d * t) / H;
        const STEP = 40;
        let cur = o;
        for (let j = 0; j < 3; j++) {
          const b = projectBox(d, cur);
          const dx = view.x + view.w / 2 - b.cx;
          const dy = view.y + view.h / 2 - b.cy;
          if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) break;
          const gx =
            (projectBox(d, _o.copy(cur).addScaledVector(camRight, -STEP * wpp)).cx - b.cx) / STEP ||
            1;
          const gy =
            (projectBox(d, _o.copy(cur).addScaledVector(camUp, STEP * wpp)).cy - b.cy) / STEP || 1;
          cur = cur
            .clone()
            .addScaledVector(camRight, (-dx / gx) * wpp)
            .addScaledVector(camUp, (dy / gy) * wpp);
        }
        return cur;
      };

      // 距离与居中要一起迭代：居中后近端会再被放大一圈，距离又得重新收一次。
      for (let i = 0; i < 8; i++) {
        let b = projectBox(dist, off);
        // 俯视 50° 会把地面纵向压缩成约 0.77 倍，而上面的粗估按 1 倍算，
        // 估出来的距离偏大、地图就缩在屏幕中间一小块（「初始化的地图太小」的根因）。
        // 对「贴合取景」（factor ≤ 1.1，如首屏 / 总览 / 城市）允许按探针的真实投影往里收，
        // 让内容真正填满可用区；带余量的取景（区县 1.45）仍然只后退、不前进，
        // 否则那点刻意留的余量会被吃掉。
        const k = Math.max((b.w * factor) / view.w, (b.h * factor) / view.h, 0.001);
        if (!Number.isFinite(k)) break;
        if (factor > 1.1 && k < 1) break;
        const rx = view.x + view.w / 2 - b.cx;
        const ry = view.y + view.h / 2 - b.cy;
        if (Math.abs(k - 1) < 0.004 && Math.abs(rx) < 1 && Math.abs(ry) < 1) break;
        dist *= k;
        off = recenter(dist, off);
      }

      // 距离可能因「带余量取景只后退不前进」而一次都没调整（如区县 factor 1.45），
      // 但居中无论如何都要做一次，否则内容会被摆在整屏中心、钻到右侧面板底下。
      off = recenter(dist, off);

      // 收尾：居中会让近端再放大一点，最后补几轮「只后退」的校正，
      // 保证最终投影一定落在可用区里（上面的循环允许往里收，可能刚好卡在边界外几像素）
      for (let i = 0; i < 4; i++) {
        const b = projectBox(dist, off);
        const k = Math.max((b.w * factor) / view.w, (b.h * factor) / view.h);
        if (!Number.isFinite(k) || k <= 1.002) break;
        dist *= k;
        off = recenter(dist, off);
      }
      offset = off;
    }

    // 调试用：记录最近一次取景的尺寸与距离，便于回归脚本定位取景问题
    this.lastFrame = { sx: +size.x.toFixed(2), sz: +size.z.toFixed(2), dist: +dist.toFixed(2) };

    const elev = (ELEV_DEG * Math.PI) / 180;
    const target = center.clone();
    const pos = new THREE.Vector3(center.x, center.y + Math.sin(elev) * dist, center.z + Math.cos(elev) * dist);
    if (offset) {
      pos.add(offset);
      target.add(offset);
    }
    this.flyTo(pos, target, duration);
  }

  /** 当前「可用视区」：左右面板与上下 HUD 会盖住画面，取景时要避开 */
  private usableView(): { x: number; y: number; w: number; h: number } {
    const el = this.renderer.domElement;
    const W = el.clientWidth || 1440;
    const H = el.clientHeight || 900;

    // 手机（≤820px）：没有常驻侧栏，上下只有窄 HUD。
    // 这里必须按「几乎整屏」算，否则取景会按桌面的 240/372 边距去缩，
    // 地图被压到中间一小块、四周留黑；同时首次取景要保证整幅地图进屏。
    // 若底部有半屏详情面板（panelFrac > 0），则额外预留其高度，
    // 让选中的市 / 区县落在屏幕上半部分而非被面板盖住。
    if (W <= 820) {
      const top = 68;
      const bottom = this.panelFrac > 0 ? Math.max(58, this.panelFrac * H) : 58;
      return {
        x: 6,
        y: top,
        w: Math.max(W - 12, 240),
        h: Math.max(H - top - bottom, 240),
      };
    }

    // 左侧索引面板实际占 16 + 214 = 230，原来的 240 多留了 10px
    const left = W <= 1280 ? 202 : 234;
    // 右侧只在面板真的打开时才让位；否则整幅地图可以用到几乎满屏（启动时明显更大）
    const right = this.sidePanelOpen ? 372 : 18;
    // 顶栏 / 底栏实际只占 16 + 36~44，原来的 88 / 76 多留了近 30px，
    // 首屏地图是按高度定距离的，这里各收紧一档，地图就能再大一点
    const top = 70; // 顶栏（16 + 44 + 10 呼吸）
    const bottom = 64; // 底栏
    return {
      x: left,
      y: top,
      w: Math.max(W - left - right, 260),
      h: Math.max(H - top - bottom, 260),
    };
  }

  private flyTo(pos: THREE.Vector3, target: THREE.Vector3, duration: number): void {
    if (duration <= 0) {
      this.controls.target.copy(target);
      this.camera.position.copy(pos);
      this.camera.lookAt(target);
      this.controls.update();
      return;
    }
    this.controls.enabled = false;
    this.fly = {
      fromPos: this.camera.position.clone(),
      toPos: pos,
      fromTarget: this.controls.target.clone(),
      toTarget: target,
      t: 0,
      duration,
    };
  }

  private refreshStyles(): void {
    const hasSelection = Boolean(this.selectedDistrictId);
    for (const [id, rec] of this.districts) {
      const hovered = this.hoveredKey === `district:${id}`;
      const selected = this.selectedDistrictId === id;
      const dimmed = hasSelection && !selected;
      this.applyPlateStyle(rec, { hovered, selected, dimmed });
    }
    for (const [id, rec] of this.cities) {
      const hovered = this.hoveredKey === `city:${id}`;
      const muted = Boolean(this.focusedCityId) && this.focusedCityId !== id;
      this.applyPlateStyle(rec, { hovered, selected: false, dimmed: false, muted });
    }
  }

  private applyPlateStyle(
    rec: PlateRecord,
    state: { hovered: boolean; selected: boolean; dimmed: boolean; muted?: boolean },
  ): void {
    const caps = rec.capMaterials;
    const edges = rec.edgeMaterials;
    if (state.muted) {
      // 城市视图外的背景城市：保留省份色相压暗 + 轮廓变暗，读作「退后」而非消失。
      // 只压暗、不下沉：下沉过的板块低于周围平面，既读作「地势」又难以点选。
      for (const cap of caps) {
        cap.emissive.setHex(rec.baseEmissive);
        cap.emissiveIntensity = rec.baseIntensity * 0.34;
        cap.color.setHex(rec.mutedCapColor);
      }
      for (const e of edges) {
        e.color.setHex(rec.mutedEdgeColor);
        e.opacity = 0.34;
      }
      rec.targetY = 0;
      return;
    }
    if (state.selected) {
      // 选中态优先于悬浮：点击后鼠标往往还停在板块上，
      // 若让悬浮样式覆盖选中，已选中的区县会掉回原地
      for (const cap of caps) {
        cap.emissive.setHex(ACTIVE_EMISSIVE);
        cap.emissiveIntensity = 0.16;
        cap.color.setHex(SELECTED_FACE);
      }
      for (const e of edges) {
        e.color.setHex(ACTIVE_EMISSIVE);
        e.opacity = 1;
      }
      rec.targetY = rec.lift * 0.78;
      return;
    }
    if (state.hovered) {
      // 悬浮只做提亮，不抬升板块：抬升会在板下升起同形状基座柱，
      // 在暗场里读作一块「残影」，尤其是地图底部的城市最明显
      for (const cap of caps) {
        cap.emissive.setHex(ACTIVE_EMISSIVE);
        cap.emissiveIntensity = 0.24;
        cap.color.setHex(SELECTED_FACE);
      }
      for (const e of edges) {
        e.color.setHex(ACTIVE_EMISSIVE);
        e.opacity = 1;
      }
      rec.targetY = 0;
      return;
    }
    for (const cap of caps) {
      cap.emissive.setHex(rec.baseEmissive);
      cap.emissiveIntensity = state.dimmed ? rec.baseIntensity * 0.5 : rec.baseIntensity;
      cap.color.setHex(state.dimmed ? rec.mutedCapColor : rec.baseCapColor);
    }
    for (const e of edges) {
      e.color.setHex(rec.baseEdgeColor);
      e.opacity = state.dimmed ? 0.35 : rec.baseEdgeOpacity;
    }
    // 未选中统一保持原位：无下沉、无地势差，所有板块都在同一平面可点选
    rec.targetY = 0;
  }

  /** 板块抬升/落下的平滑过渡；基座高度跟随，填满悬空又不与板底共面 */
  private updatePlateLift(dt: number): void {
    const k = 1 - Math.pow(0.0001, dt); // 帧率无关：约 0.3s 到位 94%，观感干脆不弹跳
    for (const rec of this.cities.values()) this.stepPlateLift(rec, k);
    for (const rec of this.districts.values()) this.stepPlateLift(rec, k);
  }

  private stepPlateLift(rec: PlateRecord, k: number): void {
    // 略微高过板底，避免顶面与板底共面导致 z-fighting
    const target = Math.max(0.001, rec.targetY + 0.02);
    for (const mesh of rec.meshes) {
      const y = mesh.position.y;
      const next = y + (rec.targetY - y) * k;
      mesh.position.y = Math.abs(rec.targetY - next) < 0.001 ? rec.targetY : next;
    }
    for (const pedestal of rec.pedestals) {
      // 高度轴 = 局部 Z（见 createPedestal），不能用 scale.y
      const h = pedestal.scale.z + (target - pedestal.scale.z) * k;
      pedestal.scale.z = Math.abs(target - h) < 0.001 ? target : h;
    }
  }

  /**
   * 光点与标记跟随所属板块的抬升/落下：
   * 选中区县时板块抬起，若光点/标记停在原高度会被埋进板里（点不到、看不见），
   * 这里按板块当前高度同步顶起，落选则随板块落回。
   */
  private syncPinLift(): void {
    for (const [districtId, list] of this.pinsByDistrict) {
      const rec = this.districts.get(districtId);
      const lift = rec ? rec.meshes[0].position.y : 0;
      for (const pin of list) {
        pin.group.position.y = pin.baseY + lift;
      }
    }
    for (const marker of this.districtMarkerGroup.children) {
      const rec = this.districts.get(marker.userData.plateId as string);
      marker.userData.lift = rec ? rec.meshes[0].position.y : 0;
    }
    for (const marker of this.cityMarkerGroup.children) {
      const rec = this.cities.get(marker.userData.plateId as string);
      marker.userData.lift = rec ? rec.meshes[0].position.y : 0;
    }
  }

  private refreshPinStyles(): void {
    for (const pin of this.pins.values()) {
      const focused = pin.id === this.focusedSpotId;
      const hovered = this.hoveredKey === `pin:${pin.id}`;
      const inActiveDistrict = !this.selectedDistrictId || pin.districtId === this.selectedDistrictId;
      const dim = Boolean(this.selectedDistrictId) && !inActiveDistrict;
      pin.stateScale = (focused ? 1.8 : hovered ? 1.35 : 1) * (dim ? 0.7 : 1);
      pin.dotMaterial.opacity = dim ? 0.3 : 1;
      pin.ringMaterial.opacity = focused ? 0.95 : dim ? 0.1 : 0.5;
      pin.ringMaterial.color.setHex(focused ? 0x22d3ee : pin.dotMaterial.color.getHex());
      pin.dotMaterial.emissiveIntensity = focused ? 2.2 : pin.hot ? 1.6 : 1.1;
    }
  }

  private pick(nx: number, ny: number): THREE.Intersection | null {
    this.pointer.set(nx, ny);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const objects: THREE.Object3D[] = [];
    if (this.layer === 'city') {
      for (const rec of this.cities.values()) objects.push(...rec.meshes);
    } else {
      for (const rec of this.districts.values()) objects.push(...rec.meshes);
      for (const pin of this.pins.values()) objects.push(pin.hit);
    }
    return this.raycaster.intersectObjects(objects, false)[0] ?? null;
  }

  private toNdc(e: { clientX: number; clientY: number }): [number, number] {
    if (!this.container) return [0, 0];
    const rect = this.container.getBoundingClientRect();
    return [((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1];
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.downXY = [e.clientX, e.clientY];
  };

  private onPointerMove = (e: PointerEvent): void => {
    const [nx, ny] = this.toNdc(e);
    const hit = this.pick(nx, ny);
    const data = hit ? ((hit.object as THREE.Mesh).userData as PickInfo) : null;
    const key = data ? `${data.kind}:${data.id}` : null;

    if (key !== this.hoveredKey) {
      const prev = this.hoveredKey;
      this.hoveredKey = key;
      if (prev || key) this.refreshStyles();
      this.refreshPinStyles();
      this.onHover?.(data ? { id: data.id, name: data.name, province: data.province, kind: data.kind } : null);
    }
  };

  private onClick = (e: MouseEvent): void => {
    if (this.downXY && Math.hypot(e.clientX - this.downXY[0], e.clientY - this.downXY[1]) > 4) return;
    const [nx, ny] = this.toNdc(e);
    const hit = this.pick(nx, ny);
    const info = hit ? ((hit.object as THREE.Mesh).userData as PickInfo) : null;
    if (info) this.onPick?.(info);
  };

  private setHover(key: string | null): void {
    this.hoveredKey = key;
    this.refreshStyles();
    this.refreshPinStyles();
    if (this.container) this.container.style.cursor = key ? 'pointer' : 'default';
  }

  /** Line2 的线宽以像素计，需把画布 CSS 尺寸同步给每条边界线材质，否则线宽会被当成 NDC 变得极粗 */
  private updateLineResolutions(): void {
    if (!this.container) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w <= 0 || h <= 0) return;
    for (const map of [this.cities, this.districts]) {
      for (const rec of map.values()) {
        for (const m of rec.edgeMaterials) m.resolution.set(w, h);
      }
    }
    this.boundaryMaterial?.resolution.set(w, h);
    this.terrain?.setResolution(w, h);
  }

  private resize = (): void => {
    if (!this.container) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    // 容器尺寸为 0（初始化时序 / 移动端地址栏收放）时 w/h 会变成 Infinity 或 NaN，
    // 一旦写进 camera.aspect 就会把投影矩阵整体污染成 NaN，画面全黑且不自愈。
    if (w <= 0 || h <= 0) return;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.updateLineResolutions();
  };

  private tick = (t: number): void => {
    if (this.paused) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min((t - this.lastT) / 1000, 0.05);
    this.lastT = t;

    if (this.stars) this.stars.rotation.y += dt * 0.015;

    this.updatePlateLift(dt);

    // 光点保持静态：持续的脉冲缩放与上下浮动在城市视图下读作
    // 「各区县起起伏伏」，焦点态用静态放大 + 提亮来表达
    this.syncPinLift();

    if (this.fly) {
      const f = this.fly;
      f.t += dt;
      const k = Math.min(f.t / f.duration, 1);
      const ease = 1 - Math.pow(1 - k, 3);
      this.camera.position.lerpVectors(f.fromPos, f.toPos, ease);
      this.controls.target.lerpVectors(f.fromTarget, f.toTarget, ease);
      this.camera.lookAt(this.controls.target);
      if (k >= 1) {
        this.fly = null;
        this.controls.enabled = true;
      }
    } else {
      this.controls.update();
    }

    this.updatePinScales();
    this.updateMarkerScales();
    this.terrain?.update(t, dt);
    if (this.weatherOn && this.weatherFX) this.weatherFX.update(dt);

    // 锚点卡靠近视口边缘时隐藏，避免被顶部/侧边裁切
    if (this.anchor) {
      const v = this.anchorNdc.copy(this.anchor.position).project(this.camera);
      this.anchor.visible =
        v.z < 1 && v.z > -1 && v.y < 0.82 && v.y > -0.9 && v.x > -0.9 && v.x < 0.9;
    }

    this.composer.render();
    this.labelRenderer.render(this.scene, this.camera);
  };

  /** 收藏/去过标记保持屏幕恒定大小（与 pin 同理），缩放到哪都清晰可辨 */
  private updateMarkerScales(): void {
    if (!this.cityMarkerGroup.children.length && !this.districtMarkerGroup.children.length) return;
    const h = this.container?.clientHeight ?? 0;
    if (!h) return;
    const dist = Math.max(this.camera.position.distanceTo(this.controls.target), 0.001);
    const fov = (this.camera.fov * Math.PI) / 180;
    const pxPerUnit = h / (2 * Math.tan(fov / 2) * dist);
    const layers: [THREE.Group, Map<string, PlateRecord>][] = [
      [this.cityMarkerGroup, this.cities],
      [this.districtMarkerGroup, this.districts],
    ];
    for (const [group, records] of layers) {
      const layerBase = this.layerBase(group);
      for (const marker of group.children) {
        const kind = (marker.userData.kind as MarkerKind) ?? 'favorite';
        // 贴片：屏幕高度反算世界高度，宽度按画布比例，不再有缩放上限。
        // 去过标记按当前样式取不同基准高度——印章 / 脚印是实心块，同高度下比细长的旗子重得多。
        const pxH =
          kind === 'visited' ? VISITED_SCREEN_PX[this.visitedStyle] : FAVORITE_SCREEN_PX;
        const worldH = pxH / pxPerUnit;
        const worldW = worldH * MARKER_ASPECT;
        marker.scale.set(worldW, worldH, 1);
        // 同一地点的多个标记按自身宽度错开，远看不会叠成一团
        const ax = marker.userData.anchorX as number | undefined;
        const az = marker.userData.anchorZ as number | undefined;
        if (ax !== undefined && az !== undefined) {
          marker.position.x = ax + ((marker.userData.offX as number) || 0) * worldW * 0.42;
          marker.position.z = az + ((marker.userData.offZ as number) || 0) * worldW * 0.42;
        }
        // 贴片底边贴地表：落点随缩放后的实际坐标重新取一次。
        // 错开的偏移量是按 worldW 算的（随缩放变化），若沿用建标记时的取样点，
        // 缩放后标记会飘到别处、脚下高度对不上（省视角的爱心离地约 2.5px 就是这么来的）。
        const rec = records.get(marker.userData.plateId as string);
        const ground = rec
          ? this.markerGroundY(marker.position.x, marker.position.z, rec.height, layerBase)
          : (marker.userData.baseY as number) || 0;
        if (rec) marker.userData.baseY = ground + 0.03;
        // 只抬 0.03（约 0.2~1px）：贴片本来就关了深度测试，抬多了就是肉眼可见的「悬空」
        marker.position.y =
          ground + 0.03 + ((marker.userData.lift as number) || 0);
      }
    }
  }

  /** pin 保持屏幕恒定大小：世界尺寸随相机距离反算，避免下钻后变成巨球 */
  private updatePinScales(): void {
    if (this.pins.size === 0) return;
    const h = this.container?.clientHeight ?? 0;
    if (!h) return;
    const dist = Math.max(this.camera.position.distanceTo(this.controls.target), 0.001);
    const fov = (this.camera.fov * Math.PI) / 180;
    const pxPerUnit = h / (2 * Math.tan(fov / 2) * dist);
    const base = Math.min(Math.max(PIN_SCREEN_PX / (0.6 * pxPerUnit), 0.04), 1.4);
    for (const pin of this.pins.values()) {
      pin.group.scale.setScalar(base * pin.stateScale * (pin.hot ? 1.12 : 1));
    }
  }

  private setupLights(): void {
    this.scene.add(new THREE.HemisphereLight(0x8899cc, 0x0a0d14, 1.3));
    this.scene.add(new THREE.AmbientLight(0x1b2637, 0.35));

    const dir = new THREE.DirectionalLight(0xffffff, 2.4);
    this.sun = dir;
    dir.position.set(80, 160, 40);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    const s = 160;
    dir.shadow.camera.left = -s;
    dir.shadow.camera.right = s;
    dir.shadow.camera.top = s;
    dir.shadow.camera.bottom = -s;
    dir.shadow.camera.far = 600;
    this.scene.add(dir);
  }

  /**
   * 程序化「摄影棚」环境贴图：给板块提供可以反射的东西。
   *
   * 这是地图有没有光泽的关键 —— 之前只靠两盏灯，metalness 没有环境可反射，
   * 金属度再高也只会发闷发黑，看着就是一块哑光塑料。
   * 这里用一个暗色盒子 + 顶部冷光 + 两条斜置灯带烘成 envMap，
   * 反射到板块的清漆面上就是随视角流动的冷白高光带。
   */
  private setupEnvironment(): void {
    // 用一张手绘的等距柱状图代替「真场景烘焙」：
    // fromScene 要渲染 6 个面再做多级模糊，在软件渲染（回归用的 swiftshader）下要好几秒，
    // 会把首屏交互一起拖住；fromEquirectangular 只处理一张 2D 图，快一个量级。
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // 天顶偏冷的暗蓝 → 地平线略亮 → 地面近黑
    const sky = ctx.createLinearGradient(0, 0, 0, 256);
    sky.addColorStop(0, '#7fa8d8');
    sky.addColorStop(0.4, '#2b3f5c');
    sky.addColorStop(0.52, '#101a2b');
    sky.addColorStop(1, '#05070d');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 512, 256);

    // 地平线上方一条柔和灯带：反射到板块顶面就是那道「扫光」
    const band = ctx.createLinearGradient(0, 88, 0, 150);
    band.addColorStop(0, 'rgba(230,241,255,0)');
    band.addColorStop(0.5, 'rgba(230,241,255,0.85)');
    band.addColorStop(1, 'rgba(230,241,255,0)');
    ctx.fillStyle = band;
    ctx.fillRect(0, 88, 512, 62);

    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const rt = pmrem.fromEquirectangular(tex);
    this.scene.environment = rt.texture;
    this.envRT = rt;
    tex.dispose();
    pmrem.dispose();
  }

  private setupGround(): void {
    // 中心线颜色与网格线统一：否则 THREE.GridHelper 的 centerLine 会比网格线更亮，
    // 在地图中部（安徽左侧 / 上海右侧）露出一根横穿的亮线。
    // 手机上同屏塞下整幅地图，40 格地面网格会密成一片、与区县边界抢视线，这里减半并压暗
    const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 820px)').matches;
    const grid = new THREE.GridHelper(400, narrow ? 16 : 40, 0x0d1626, 0x0d1626);
    const gm = grid.material as THREE.LineBasicMaterial;
    gm.transparent = true;
    gm.opacity = narrow ? 0.22 : 0.4;
    grid.position.y = -0.5;
    this.grid = grid;
    this.scene.add(grid);

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
    grad.addColorStop(0, 'rgba(42,62,98,0.5)');
    grad.addColorStop(0.45, 'rgba(20,30,50,0.25)');
    grad.addColorStop(1, 'rgba(5,7,13,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    const tex = new THREE.CanvasTexture(canvas);
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -1;
    this.scene.add(this.ground);
  }

  private setupStars(): void {
    const count = 700;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 360;
      positions[i * 3 + 1] = 10 + Math.random() * 90;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 360;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    // 用一张圆形 sprite 贴图把方点变成圆点，营造「星空」而非「马赛克格」的漂浮感。
    const sprite = this.makeStarSprite();
    const mat = new THREE.PointsMaterial({
      color: 0x9cc3d9,
      size: 0.9,
      map: sprite,
      alphaMap: sprite,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      alphaTest: 0.05,
    });
    this.stars = new THREE.Points(geo, mat);
    this.scene.add(this.stars);
  }

  /** 生成柔边圆形点精灵（中心亮、边缘透明），供星空 PointsMaterial 复用 */
  private makeStarSprite(): THREE.Texture {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const r = size / 2;
    const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(220,240,255,0.95)');
    grad.addColorStop(0.7, 'rgba(150,200,235,0.35)');
    grad.addColorStop(1, 'rgba(150,200,235,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(r, r, r, 0, Math.PI * 2);
    ctx.fill();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
}
