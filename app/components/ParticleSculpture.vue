<script setup lang="ts">
const host = ref<HTMLDivElement>()
const ready = ref(false)
const playing = ref(true)
const shape = ref(0)
let dispose: (() => void) | undefined
let cancelled = false
onMounted(async () => {
  const THREE = await import('three')
  if (cancelled || !host.value) return
  const container = host.value
  let renderer: InstanceType<typeof THREE.WebGLRenderer>
  try {
    renderer = new THREE.WebGLRenderer({alpha: true, antialias: true, powerPreference: 'low-power'})
  } catch {
    return
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
  container.appendChild(renderer.domElement)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(40, 1, .1, 100)
  camera.position.z = 8.7
  const geometry = new THREE.TorusKnotGeometry(1.48, .44, 290, 28, 2, 3)
  const positions = geometry.attributes.position!
  const targets = new Float32Array(positions.count * 3)
  for (let i = 0; i < positions.count; i++) {
    const y = 1 - (i / (positions.count - 1)) * 2
    const radius = Math.sqrt(1 - y * y)
    const theta = Math.PI * (3 - Math.sqrt(5)) * i
    targets.set([Math.cos(theta) * radius * 2.05, y * 2.05, Math.sin(theta) * radius * 2.05], i * 3)
  }
  geometry.setAttribute('aTarget', new THREE.BufferAttribute(targets, 3))
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {uTime: {value: 0}, uMorph: {value: 0}, uRatio: {value: renderer.getPixelRatio()}},
    vertexShader: `attribute vec3 aTarget; uniform float uTime; uniform float uMorph; uniform float uRatio; varying float vLight; void main() { vec3 pos = mix(position, aTarget, uMorph); pos += normal * sin(uTime * .65 + position.y * 2.8) * .026; vec4 mv = modelViewMatrix * vec4(pos, 1.); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(13. * uRatio / -mv.z, 1., 5.); vLight = .35 + .65 * smoothstep(-2., 2., pos.z); }`,
    fragmentShader: `varying float vLight; void main() { float d = length(gl_PointCoord - .5); if(d > .5) discard; vec3 color = mix(vec3(.20, .42, .16), vec3(.76, .98, .46), vLight); gl_FragColor = vec4(color, (.40 + .60 * vLight) * smoothstep(.5, .14, d)); }`
  })
  const sculpture = new THREE.Points(geometry, material)
  sculpture.rotation.set(.45, .25, -.35)
  scene.add(sculpture)
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  playing.value = !reduced.matches
  let intersecting = true
  let frame = 0
  let last = 0
  let elapsed = 0
  const pointer = {x: 0, y: 0}

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
    const delta = Math.min((now - last) / 1000, .05)
    last = now
    if (!intersecting || document.hidden) return
    if (playing.value) elapsed += delta
    material.uniforms.uTime!.value = elapsed
    material.uniforms.uMorph!.value += (shape.value - material.uniforms.uMorph!.value) * (reduced.matches ? 1 : .045)
    const tiltX = reduced.matches ? 0 : pointer.y * .22
    const tiltY = reduced.matches ? 0 : pointer.x * .3
    sculpture.rotation.x += (.45 + tiltX - sculpture.rotation.x) * .035
    sculpture.rotation.y = .25 + elapsed * .09 + tiltY
    renderer.render(scene, camera)
  }
  frame = requestAnimationFrame(render)
  ready.value = true
  dispose = () => {
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    visibilityObserver.disconnect();
    container.removeEventListener('pointermove', move);
    container.removeEventListener('pointerleave', leave);
    reduced.removeEventListener('change', motionChanged);
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
         :aria-label="shape ? '绿色粒子球体，可通过按钮切换形态' : '绿色粒子构成的三维环结，可通过鼠标交互'"/>
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
        <button :class="{ selected: shape === 0 }" :aria-pressed="shape === 0" aria-label="切换环结形态"
                @click="shape = 0">01
        </button>
        <button :class="{ selected: shape === 1 }" :aria-pressed="shape === 1" aria-label="切换球体形态"
                @click="shape = 1">02
        </button>
        <button :aria-label="playing ? '暂停动画' : '播放动画'" @click="playing = !playing">
          <AppIcon :name="playing ? 'pause' : 'play'" :size="12"/>
        </button>
      </div>
    </div>
  </div>
</template>
