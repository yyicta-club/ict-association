<script setup lang="ts">
const props = withDefaults(defineProps<{
    modelValue: boolean
    label?: string
}>(), {label: ''})

const emit = defineEmits<{ 'update:modelValue': [value: boolean]}>()

function toggle() {
    emit('update:modelValue', !props.modelValue)
}
</script>

<template>
  <button type="button" class="admin-switch" :class="{'is-on': modelValue}" role="switch"
          :aria-checked="modelValue" :aria-label="label || '切换开关'" @click="toggle"/>
</template>
