<script setup lang="ts">
const props = defineProps<{
    modelValue: boolean
    title: string
    description?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

function close() {
    emit('update:modelValue', false)
}

function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') close()
}

onMounted(() => document.addEventListener('keydown', onKey))
onUnmounted(() => document.removeEventListener('keydown', onKey))

watch(() => props.modelValue, value => {
    document.body.style.overflow = value ? 'hidden' : ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="admin-fade">
      <div v-if="modelValue" class="admin-drawer-mask" @click="close"/>
    </Transition>
    <Transition name="admin-drawer">
      <aside v-if="modelValue" class="admin-drawer" role="dialog" aria-modal="true" :aria-label="title">
        <header class="admin-drawer-head">
          <div>
            <h2>{{ title }}</h2>
            <p v-if="description">{{ description }}</p>
          </div>
          <button class="admin-icon-btn" type="button" aria-label="关闭" @click="close">
            <AdminIcon name="close" :size="16"/>
          </button>
        </header>
        <div class="admin-drawer-body">
          <slot/>
        </div>
        <footer v-if="$slots.footer" class="admin-drawer-foot">
          <slot name="footer"/>
        </footer>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.admin-drawer-enter-active, .admin-drawer-leave-active {
    transition: transform .34s cubic-bezier(.4, 0, .2, 1), opacity .24s
}

.admin-drawer-enter-from, .admin-drawer-leave-to {
    transform: translateX(100%);
    opacity: .4
}
</style>
