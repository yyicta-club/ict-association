<script setup lang="ts">
import type * as T3 from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
const host = ref<HTMLDivElement>()
const ready = ref(false)
const playing = ref(true)
let dispose: (() => void) | undefined
let cancelled = false
const PARTICLE_COUNT = 38000 // 粒子总数，按表面积分摊到各 mesh

onMounted(async () => {
  // three 及 GLTFLoader 均为按需动态加载：首屏不阻塞，WebGL/加载失败时静默降级到 SVG fallback
  const THREE = await import('three')
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  if (cancelled || !host.value) return
  const container = host.value
  // 释放 GLB 场景内的几何体 / 材质 / 贴图资源（组件卸载与各失败分支共用）
  const releaseModel = (gltf: GLTF) => {
    gltf.scene.traverse((object: T3.Object3D) => {
      const mesh = object as T3.Mesh
      mesh.geometry?.dispose()
      const material = mesh.material
      const list = Array.isArray(material) ? material : material ? [material] : []
      list.forEach(item => {
        ;(item as T3.MeshStandardMaterial).map?.dispose()
        item.dispose()
      })
    })
  }
  let gltf: GLTF
  try {
    gltf = await new GLTFLoader().loadAsync('/glb/logo.glb')
  } catch {
    return // 模型加载失败：保持 SVG fallback
  }
  if (cancelled || !host.value) {
    releaseModel(gltf)
    return
  }
  let renderer: InstanceType<typeof THREE.WebGLRenderer>
  try {
    // low-power：粒子雕塑负载低，优先省电（移动端友好）
    renderer = new THREE.WebGLRenderer({alpha: true, antialias: true, powerPreference: 'low-power'})
  } catch {
    releaseModel(gltf)
    return // WebGL 不可用：降级到 SVG fallback
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
  container.appendChild(renderer.domElement)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(40, 1, .1, 100)
  camera.position.z = 8.7

  // ---- 对 GLB 表面采样生成粒子（位置 / 法线 / 颜色） ----
  const meshes: T3.Mesh[] = []
  gltf.scene.updateMatrixWorld(true)
  gltf.scene.traverse((object: T3.Object3D) => {
    const mesh = object as T3.Mesh
    // 跳过非网格 / 蒙皮网格 / 空几何体；缺法线的几何体现场补算（呼吸扰动需要）
    if (!mesh.isMesh || (mesh as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) return
    if (!mesh.geometry?.attributes?.position?.count) return
    if (!mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals()
    meshes.push(mesh)
  })
  if (!meshes.length) {
    releaseModel(gltf)
    renderer.dispose()
    renderer.domElement.remove()
    return
  }

  // 统一坐标系：所有 mesh 以整体包围盒中心为原点、最长边缩放到 3.6（≈ ±1.8，匹配相机取景）
  const bounds = new THREE.Box3()
  meshes.forEach(mesh => bounds.expandByObject(mesh))
  const modelCenter = bounds.getCenter(new THREE.Vector3())
  const modelSize = bounds.getSize(new THREE.Vector3())
  const modelScale = 6 / Math.max(modelSize.x, modelSize.y, modelSize.z, 1e-6)

  // 贴图色是 sRGB 编码，采样后需转线性空间才能与材质色（本身是线性）统一进入着色器
  const srgbToLinear = (channel: number) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
  const themeColor = new THREE.Color('#c2f970')
  const fallbackColor: [number, number, number] = [themeColor.r, themeColor.g, themeColor.b]

  // texture pixels for meshes whose colors only live in a texture map
  // 贴图分支用：把材质的 map 栅格化成 ≤256px 的像素数组，供按 UV 取色
  function texturePixels(material: T3.Material) {
    const image = (material as T3.MeshStandardMaterial).map?.image as
      | HTMLImageElement | HTMLCanvasElement | ImageBitmap | undefined
    if (!image || !image.width || !image.height) return
    const ratio = Math.min(1, 256 / Math.max(image.width, image.height))
    const w = Math.max(1, Math.round(image.width * ratio))
    const h = Math.max(1, Math.round(image.height * ratio))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', {willReadFrequently: true})
    if (!ctx) return
    ctx.drawImage(image, 0, 0, w, h)
    return { data: ctx.getImageData(0, 0, w, h).data, w, h }
  }

  // 颜色来源：贴图（按 UV 取像素）或纯色（材质 color），顶点色优先级在 writeParticle 内处理
  type ColorSource = { kind: 'flat', color: [number, number, number] }
    | { kind: 'texture', data: Uint8ClampedArray, w: number, h: number }
  // 单个 mesh 的采样元数据：三角形累进面积表用于面积加权抽取，groups 映射到多材质
  interface MeshInfo {
    position: T3.BufferAttribute
    normal: T3.BufferAttribute
    uv?: T3.BufferAttribute
    vertexColor?: T3.BufferAttribute
    index?: T3.BufferAttribute
    triCount: number
    cumulative: Float64Array
    area: number
    matrix: T3.Matrix4
    normalMatrix: T3.Matrix3
    sources: ColorSource[]
    triMaterial: Int32Array
  }

  // 三角形临时向量复用，避免每个三角形采样都分配新对象
  const edgeB = new THREE.Vector3()
  const edgeC = new THREE.Vector3()
  const cornerA = new THREE.Vector3()
  const cornerB = new THREE.Vector3()
  const cornerC = new THREE.Vector3()
  const infos: MeshInfo[] = []
  for (const mesh of meshes) {
    const geometry = mesh.geometry
    const position = geometry.attributes.position as T3.BufferAttribute
    const normal = geometry.attributes.normal as T3.BufferAttribute
    const uv = geometry.attributes.uv as T3.BufferAttribute | undefined
    const vertexColor = geometry.attributes.color as T3.BufferAttribute | undefined
    const index = geometry.index ?? undefined
    const triCount = Math.floor((index ? index.count : position.count) / 3)
    if (!triCount) continue
    const cumulative = new Float64Array(triCount)
    let area = 0
    // 预计算每个三角形的面积与前缀和（cumulative[t] = 前 t+1 个三角形面积总和），供二分抽取
    for (let t = 0; t < triCount; t++) {
      const i0 = index ? index.getX(t * 3) : t * 3
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2
      cornerA.fromBufferAttribute(position, i0)
      cornerB.fromBufferAttribute(position, i1)
      cornerC.fromBufferAttribute(position, i2)
      edgeB.subVectors(cornerB, cornerA)
      edgeC.subVectors(cornerC, cornerA)
      area += edgeB.cross(edgeC).length() / 2
      cumulative[t] = area
    }
    const material = mesh.material
    const materialList = Array.isArray(material) ? material : [material]
    const triMaterial = new Int32Array(triCount)
    // 有材质分组（draw groups）时，建立三角形 → 材质索引的映射，保证颜色一一对应
    if (geometry.groups.length) {
      for (let t = 0; t < triCount; t++) {
        const start = t * 3
        const group = geometry.groups.find(item => start >= item.start && start < item.start + item.count)
        triMaterial[t] = group?.materialIndex ?? 0
      }
    }
    const sources: ColorSource[] = materialList.map(item => {
      const texture = uv ? texturePixels(item) : undefined
      if (texture) return { kind: 'texture', ...texture }
      // 贴图优先 → 材质纯色（GLTFLoader 已把 baseColorFactor 转为线性 Color）→ 主题色兜底
      const flat = (item as T3.MeshStandardMaterial).color
      if (flat) return { kind: 'flat', color: [flat.r, flat.g, flat.b] }
      return { kind: 'flat', color: fallbackColor }
    })
    infos.push({
      position, normal, uv, vertexColor, index, triCount, cumulative, area,
      matrix: mesh.matrixWorld,
      normalMatrix: new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld),
      sources, triMaterial
    })
  }

  const totalArea = infos.reduce((sum, info) => sum + info.area, 0)
  if (totalArea <= 0) {
    releaseModel(gltf)
    renderer.dispose()
    renderer.domElement.remove()
    return
  }

  const positions = new Float32Array(PARTICLE_COUNT * 3)
  const normals = new Float32Array(PARTICLE_COUNT * 3)
  const colors = new Float32Array(PARTICLE_COUNT * 3)
  const samplePosition = new THREE.Vector3()
  const sampleNormal = new THREE.Vector3()

  // 面积加权重心坐标采样单个粒子，写入第 n 号粒子的位置/法线/颜色
  // 返回 false 表示采到了全透明贴图像素或被视角筛选拒绝，调用方会重试或用兜底色
  function writeParticle(info: MeshInfo, n: number): boolean {
    let triangle = 0
    if (info.triCount > 1) {
      // 在累进面积表上均匀抽取随机数后二分查找：面积大的三角形被选中概率更高
      const r = Math.random() * (info.cumulative[info.triCount - 1] ?? info.area)
      let lo = 0
      let hi = info.triCount - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if ((info.cumulative[mid] ?? 0) < r) lo = mid + 1
        else hi = mid
      }
      triangle = lo
    }
    const i0 = info.index ? info.index.getX(triangle * 3) : triangle * 3
    const i1 = info.index ? info.index.getX(triangle * 3 + 1) : triangle * 3 + 1
    const i2 = info.index ? info.index.getX(triangle * 3 + 2) : triangle * 3 + 2
    let bu = Math.random()
    let bv = Math.random()
    // 重心坐标 (bw, bu, bv)；若落在三角形外则折叠回来（保证均匀分布于三角形内）
    if (bu + bv > 1) {
      bu = 1 - bu
      bv = 1 - bv
    }
    const bw = 1 - bu - bv
    cornerA.fromBufferAttribute(info.position, i0)
    cornerB.fromBufferAttribute(info.position, i1)
    cornerC.fromBufferAttribute(info.position, i2)
    samplePosition.copy(cornerA).multiplyScalar(bw).addScaledVector(cornerB, bu).addScaledVector(cornerC, bv)
    // 顶点位置经 matrixWorld 进入世界空间，再平移到整体中心并统一缩放
    samplePosition.applyMatrix4(info.matrix).sub(modelCenter).multiplyScalar(modelScale)
    positions.set([samplePosition.x, samplePosition.y, samplePosition.z], n * 3)
    cornerA.fromBufferAttribute(info.normal, i0)
    cornerB.fromBufferAttribute(info.normal, i1)
    cornerC.fromBufferAttribute(info.normal, i2)
    sampleNormal.copy(cornerA).multiplyScalar(bw).addScaledVector(cornerB, bu).addScaledVector(cornerC, bv)
    // 法线须用 normalMatrix（逆转置）变换，缩放不均匀时才不会失真
    sampleNormal.applyMatrix3(info.normalMatrix).normalize()
    // 视角加权（接受-拒绝采样）：正对相机的面 |normal.z|≈1 全部接受，
    // 掠射面（侧面/轮廓）按概率拒绝重采，抵消"斜面在屏幕上摊开/重叠"造成的
    // 投影密度不均——小面板与弯曲大面在屏幕上的点密度因此趋于一致。
    // +.12 下限保证轮廓边缘仍保留少量点勾边，|·| 让背面同样参与（相机两侧对称）
    if (Math.random() > Math.min(1, Math.abs(sampleNormal.z) + .12)) return false
    normals.set([sampleNormal.x, sampleNormal.y, sampleNormal.z], n * 3)

    let red = 0
    let green = 0
    let blue = 0
    const vertexColor = info.vertexColor
    if (vertexColor) {
      // 颜色取值优先级一：顶点色，三个顶点插值（已是线性空间）
      red = vertexColor.getX(i0) * bw + vertexColor.getX(i1) * bu + vertexColor.getX(i2) * bv
      green = vertexColor.getY(i0) * bw + vertexColor.getY(i1) * bu + vertexColor.getY(i2) * bv
      blue = vertexColor.getZ(i0) * bw + vertexColor.getZ(i1) * bu + vertexColor.getZ(i2) * bv
    } else {
      // 优先级二/三：按三角形所属材质组取贴图色（UV 插值取像素，透明则重试）或材质纯色
      const source = info.sources[info.triMaterial[triangle] ?? 0] ?? info.sources[0]
      if (source?.kind === 'flat') {
        red = source.color[0]
        green = source.color[1]
        blue = source.color[2]
      } else if (source?.kind === 'texture' && info.uv) {
        const uv = info.uv
        const u = uv.getX(i0) * bw + uv.getX(i1) * bu + uv.getX(i2) * bv
        const v = uv.getY(i0) * bw + uv.getY(i1) * bu + uv.getY(i2) * bv
        const x = Math.min(source.w - 1, Math.max(0, Math.floor(u * source.w)))
        const y = Math.min(source.h - 1, Math.max(0, Math.floor(v * source.h)))
        const offset = (y * source.w + x) * 4
        if ((source.data[offset + 3] ?? 0) < 128) return false
        red = srgbToLinear((source.data[offset] ?? 0) / 255)
        green = srgbToLinear((source.data[offset + 1] ?? 0) / 255)
        blue = srgbToLinear((source.data[offset + 2] ?? 0) / 255)
      } else {
        // 兜底：无顶点色也无可用贴图/材质色时使用主题色
        red = fallbackColor[0]
        green = fallbackColor[1]
        blue = fallbackColor[2]
      }
    }
    colors.set([red, green, blue], n * 3)
    return true
  }

  // 各 mesh 的粒子配额按表面积占比分配（至少 1 个），贴合模型外形密度
  const counts = infos.map(info => Math.max(info.area > 0 ? 1 : 0, Math.round(PARTICLE_COUNT * info.area / totalArea)))
  let written = 0
  infos.forEach((info, meshIndex) => {
    const count = counts[meshIndex] ?? 0
    for (let j = 0; j < count && written < PARTICLE_COUNT; j++) {
      let ok = false
      for (let guard = 0; guard < 24 && !ok; guard++) ok = writeParticle(info, written)
      if (!ok) colors.set(fallbackColor, written * 3)
      written++
    }
  })
  // 面积取整造成的差额由最大 mesh 吸收，保证总数恰好等于 PARTICLE_COUNT
  const largest = infos.reduce((best, info) => info.area > best.area ? info : best, infos[0]!)
  while (written < PARTICLE_COUNT) {
    let ok = false
    for (let guard = 0; guard < 24 && !ok; guard++) ok = writeParticle(largest, written)
    if (!ok) colors.set(fallbackColor, written * 3)
    written++
  }

  // 粒子缓冲几何：位置 + 法线 + 颜色三组 attribute（aColor 线性空间，直接还原模型原色）
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aNormal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
  // NormalBlending（非加色混合）+ colorspace_fragment 输出转换，保证真实色彩还原
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    uniforms: { uTime: { value: 0 }, uRatio: { value: renderer.getPixelRatio() } },
    vertexShader: `attribute vec3 aNormal; attribute vec3 aColor; uniform float uTime; uniform float uRatio; varying vec3 vColor; varying float vLight;
      void main() {
        // 呼吸扰动：沿法线做周期性正弦起伏，以 position.y 为相位让起伏沿高度错开
        vec3 pos = position + aNormal * sin(uTime * .65 + position.y * 2.8) * .03;
        vec4 mv = modelViewMatrix * vec4(pos, 1.);
        gl_Position = projectionMatrix * mv;
        // 点大小随距离衰减，clamp 到 [1, 5] 避免远近端过小/过大
        gl_PointSize = clamp(13. * uRatio / -mv.z, 1., 5.);
        vec3 viewNormal = normalize(normalMatrix * aNormal);
        // 简易朝向光照：法线朝向相机的粒子更亮，让形体有立体层次
        vLight = .45 + .55 * smoothstep(-.7, 1., viewNormal.z);
        vColor = aColor;
      }`,
    fragmentShader: `varying vec3 vColor; varying float vLight;
      void main() {
        // 圆形软边点精灵：中心不透明向外平滑衰减
        float d = length(gl_PointCoord - .5);
        if (d > .5) discard;
        gl_FragColor = vec4(vColor * vLight, (.72 + .28 * vLight) * smoothstep(.5, .14, d));
        // three 内置 chunk：把线性色转换为输出色彩空间（sRGB 显示器）
        #include <colorspace_fragment>
      }`
  })
  const sculpture = new THREE.Points(geometry, material)
  scene.add(sculpture)
  // prefers-reduced-motion：默认暂停动画，并让摆动/倾斜强度归零
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  playing.value = !reduced.matches
  let intersecting = true
  let frame = 0
  let last = 0
  let elapsed = 0
  // 指针位置归一化到 ±0.5（相对容器中心），leave 时归零回正
  const pointer = {x: 0, y: 0}
  const swing = THREE.MathUtils.degToRad(35) // z 轴往复摆动幅度：±35°

  function move(event: PointerEvent) {
    const rect = container.getBoundingClientRect();
    pointer.x = (event.clientX - rect.left) / rect.width - .5;
    pointer.y = (event.clientY - rect.top) / rect.height - .5
  }

  function leave() {
    pointer.x = 0;
    pointer.y = 0
  }

  function resize() {
    const {width, height} = container.getBoundingClientRect();
    renderer.setSize(width, height);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix()
  }

  function motionChanged() {
    playing.value = !reduced.matches
  }

  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(container)
  // 视口外 / 标签页隐藏时跳过渲染，省电
  const visibilityObserver = new IntersectionObserver(entries => {
    intersecting = entries[0]?.isIntersecting ?? false
  })
  visibilityObserver.observe(container)
  container.addEventListener('pointermove', move)
  container.addEventListener('pointerleave', leave)
  reduced.addEventListener('change', motionChanged)
  resize()
  const render = (now: number) => {
    frame = requestAnimationFrame(render)
    // delta 上限 .05：标签页切回时避免大跳变
    const delta = Math.min((now - last) / 1000, .05)
    last = now
    if (!intersecting || document.hidden) return
    // 暂停即冻结 elapsed：自转相位与呼吸扰动同时停住
    if (playing.value) elapsed += delta
    material.uniforms.uTime!.value = elapsed
    // 鼠标跟随倾斜：目标角由指针位置换算，每帧以 .035 缓动系数逼近（平滑跟随）
    const tiltX = reduced.matches ? 0 : pointer.y * .22
    const tiltY = reduced.matches ? 0 : pointer.x * .3
    sculpture.rotation.x += (tiltX - sculpture.rotation.x) * .035
    sculpture.rotation.y += (tiltY - sculpture.rotation.y) * .035
    // 整体自转：绕 y 轴在 -35° ~ +35° 之间正弦往复循环
    sculpture.rotation.y = reduced.matches ? 0 : Math.sin(elapsed * .45) * swing
    renderer.render(scene, camera)
  }
  frame = requestAnimationFrame(render)
  ready.value = true
  dispose = () => {
    // 完整清理：动画帧、观察器、事件、GLB 资源、粒子几何/材质、渲染器
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    visibilityObserver.disconnect();
    container.removeEventListener('pointermove', move);
    container.removeEventListener('pointerleave', leave);
    reduced.removeEventListener('change', motionChanged);
    releaseModel(gltf);
    geometry.dispose();
    material.dispose();
    renderer.dispose();
    renderer.domElement.remove()
  }
})
onUnmounted(() => {
  cancelled = true;
  dispose?.()
})
</script>

<template>
  <div class="sculpture">
    <div class="sculpture-coordinates mono"><span>FIG. 001 — CONNECTED POSSIBILITIES</span><span>INTERACTIVE / 3D</span>
    </div>
    <div class="orbital orbital-one" aria-hidden="true"/>
    <div class="orbital orbital-two" aria-hidden="true"/>
    <div class="sculpture-axis axis-one" aria-hidden="true">+</div>
    <div class="sculpture-axis axis-two" aria-hidden="true">+</div>
    <div ref="host" class="sculpture-canvas" role="img"
         aria-label="logo 模型粒子化雕塑，可通过鼠标交互"/>
    <svg v-if="!ready" class="sculpture-fallback" viewBox="0 0 500 500" aria-hidden="true">
      <g fill="none" stroke="#c2f970" stroke-width=".7" opacity=".6">
        <ellipse v-for="i in 32" :key="i" cx="250" cy="250" rx="155" :ry="35 + i * 2.9"
                 :transform="`rotate(${i * 11.25} 250 250)`"/>
      </g>
    </svg>
    <span class="floating-label label-web mono"><i/> &lt;build /&gt;</span><span
      class="floating-label label-create mono"><AppIcon name="spark" :size="13"/> curiosity.connect()</span>
    <div class="sculpture-bottom"><span class="mono sculpture-hint"><span
        class="status-dot"/> {{ ready ? 'MOVE TO EXPLORE' : 'GENERATIVE GEOMETRY' }}</span>
      <div class="sculpture-controls">
        <button :aria-label="playing ? '暂停动画' : '播放动画'" @click="playing = !playing">
          <AppIcon :name="playing ? 'pause' : 'play'" :size="12"/>
        </button>
      </div>
    </div>
  </div>
</template>
