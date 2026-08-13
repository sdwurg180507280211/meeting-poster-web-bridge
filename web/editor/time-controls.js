(() => {
  const form = document.getElementById('posterForm');
  const meetingHidden = document.getElementById('meetingTime');
  const meetingHost = document.getElementById('meetingTimePicker');
  if (!form || !meetingHidden || !meetingHost) return;

  const VUE_VERSION = '3.5.21';
  const ELEMENT_VERSION = '2.14.3';
  const CDN_BASE = 'https://cdn.jsdelivr.net/npm';
  const INTEGRITY = Object.freeze({
    vue: 'sha384-mqTIL+8BYsZvn40ROhIdqBAlB7rqo0qLp6tFanwY3K6FUJRLE9fQuMY/7BvSAGFx',
    elementCss: 'sha384-Hv0k+7QghEyH5p4jV8vcaiI6XIB/DsBroXYP9GnDE+JWZrnnCTDlPgvFQ8ez9Lk9',
    elementJs: 'sha384-6+fpuLhVHP/f8MsYul+T9eEKvcevdcdPcP/Kx4ysIqD2BVGUUNn+wTr8SDJhYN8P',
    locale: 'sha384-m8Rk/VM22GjG7V7qvJpghPQJc6krmML3XhSburoe/u8owGFWOOA3hGQ9vZ+QSmn7',
  });
  const controlsState = window.posterTimeControlsState = window.posterTimeControlsState || {
    ready: false,
    failed: false,
    reason: '时间选择组件正在加载',
  };
  const scheduleOpeners = [];
  const scheduleVms = [];
  let meetingVm = null;

  function setControlsState(ready, failed, reason) {
    controlsState.ready = ready;
    controlsState.failed = failed;
    controlsState.reason = reason;
    document.dispatchEvent(new CustomEvent('poster-time-controls-state', {
      detail: { ready, failed, reason },
    }));
  }

  function emitInput(el) {
    el?.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function loadStyle(id, href, integrity) {
    return new Promise((resolve, reject) => {
      const existing = document.getElementById(id);
      if (existing) {
        if (existing.dataset.loaded === '1' || existing.sheet) resolve();
        else {
          existing.addEventListener('load', resolve, { once: true });
          existing.addEventListener('error', () => reject(new Error(`加载组件样式失败：${href}`)), { once: true });
        }
        return;
      }
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = href;
      link.integrity = integrity;
      link.crossOrigin = 'anonymous';
      link.referrerPolicy = 'no-referrer';
      link.onload = () => { link.dataset.loaded = '1'; resolve(); };
      link.onerror = () => reject(new Error(`加载组件样式失败：${href}`));
      document.head.appendChild(link);
    });
  }

  function loadScript(id, src, integrity) {
    return new Promise((resolve, reject) => {
      const existing = document.getElementById(id);
      if (existing) {
        if (existing.dataset.loaded === '1') resolve();
        else {
          existing.addEventListener('load', resolve, { once: true });
          existing.addEventListener('error', () => reject(new Error(`加载组件失败：${src}`)), { once: true });
        }
        return;
      }
      const script = document.createElement('script');
      script.id = id;
      script.src = src;
      script.integrity = integrity;
      script.crossOrigin = 'anonymous';
      script.referrerPolicy = 'no-referrer';
      script.onload = () => { script.dataset.loaded = '1'; resolve(); };
      script.onerror = () => reject(new Error(`加载组件失败：${src}`));
      document.head.appendChild(script);
    });
  }

  async function ensureElementPlus() {
    await loadStyle(
      'element-plus-css',
      `${CDN_BASE}/element-plus@${ELEMENT_VERSION}/dist/index.css`,
      INTEGRITY.elementCss,
    );
    if (!window.Vue) {
      await loadScript('vue3-cdn', `${CDN_BASE}/vue@${VUE_VERSION}/dist/vue.runtime.global.prod.js`, INTEGRITY.vue);
    }
    if (!window.ElementPlus) {
      await loadScript(
        'element-plus-cdn',
        `${CDN_BASE}/element-plus@${ELEMENT_VERSION}/dist/index.full.min.js`,
        INTEGRITY.elementJs,
      );
    }
    if (!window.ElementPlusLocaleZhCn) {
      try {
        await loadScript(
          'element-plus-zh-cn',
          `${CDN_BASE}/element-plus@${ELEMENT_VERSION}/dist/locale/zh-cn.min.js`,
          INTEGRITY.locale,
        );
      } catch (err) {
        console.warn('Element Plus 中文语言包加载失败，将使用默认语言。', err);
      }
    }
    if (!window.Vue?.createApp || !window.ElementPlus) throw new Error('时间选择组件未正确初始化');
  }

  const pad = n => String(n).padStart(2, '0');
  const formatTime = date => date instanceof Date && !Number.isNaN(date.getTime())
    ? `${pad(date.getHours())}:${pad(date.getMinutes())}`
    : '';
  const formatDate = date => date instanceof Date && !Number.isNaN(date.getTime())
    ? `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
    : '';
  const timeAt = (h, m) => new Date(2000, 0, 1, h, m, 0, 0);
  const disabledMinutes = () => Array.from({ length: 60 }, (_, i) => i).filter(i => i % 5 !== 0);

  function parseTimeRange(value) {
    const m = String(value || '').trim().match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
    if (!m) return null;
    return [timeAt(Number(m[1]), Number(m[2])), timeAt(Number(m[3]), Number(m[4]))];
  }

  function parseMeeting(value) {
    const m = String(value || '').trim().match(/^(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
    if (!m) return null;
    return {
      date: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
      range: [timeAt(Number(m[4]), Number(m[5])), timeAt(Number(m[6]), Number(m[7]))],
    };
  }

  function useElementPlus(app) {
    if (window.ElementPlusLocaleZhCn) app.use(window.ElementPlus, { locale: window.ElementPlusLocaleZhCn });
    else app.use(window.ElementPlus);
  }

  function mountMeetingPicker() {
    meetingHost.innerHTML = '<div id="meetingVuePicker" class="vue-picker-host"></div>';
    const mount = document.getElementById('meetingVuePicker');
    const initial = parseMeeting(meetingHidden.value);

    const app = window.Vue.createApp({
      data() {
        return {
          date: initial?.date || null,
          range: initial?.range || [timeAt(19, 0), timeAt(20, 30)],
        };
      },
      methods: {
        disabledMinutes,
        sync() {
          const dateText = formatDate(this.date);
          const start = Array.isArray(this.range) ? formatTime(this.range[0]) : '';
          const end = Array.isArray(this.range) ? formatTime(this.range[1]) : '';
          meetingHidden.value = dateText && start && end ? `${dateText} ${start}-${end}` : '';
          emitInput(meetingHidden);
        },
        restore(value) {
          const parsed = parseMeeting(value);
          if (!parsed) return;
          this.date = parsed.date;
          this.range = parsed.range;
        },
      },
      mounted() { this.sync(); },
      render() {
        const DatePicker = window.Vue.resolveComponent('el-date-picker');
        const TimePicker = window.Vue.resolveComponent('el-time-picker');
        return window.Vue.h('div', { class: 'element-meeting-picker' }, [
          window.Vue.h(DatePicker, {
            modelValue: this.date,
            'onUpdate:modelValue': value => { this.date = value; },
            type: 'date',
            format: 'YYYY年M月D日',
            placeholder: '选择会议日期',
            size: 'small',
            editable: false,
            clearable: false,
            onChange: this.sync,
          }),
          window.Vue.h(TimePicker, {
            modelValue: this.range,
            'onUpdate:modelValue': value => { this.range = value; },
            isRange: true,
            rangeSeparator: '-',
            startPlaceholder: '开始时间',
            endPlaceholder: '结束时间',
            format: 'HH:mm',
            size: 'small',
            editable: false,
            clearable: false,
            disabledMinutes: this.disabledMinutes,
            onChange: this.sync,
          }),
        ]);
      },
    });
    useElementPlus(app);
    meetingVm = app.mount(mount);

    window.posterTimeControls = window.posterTimeControls || {};
    window.posterTimeControls.openMeeting = () => {
      const trigger = mount.querySelector('.el-date-editor');
      trigger?.click();
    };
  }

  function mountSchedulePickers() {
    for (let i = 0; i < 4; i++) {
      const hidden = document.getElementById(`s-time-${i}`);
      if (!hidden) continue;
      hidden.type = 'hidden';
      hidden.removeAttribute('placeholder');
      const initial = parseTimeRange(hidden.value);

      const mount = document.createElement('div');
      mount.id = `scheduleVueTime-${i}`;
      mount.className = 'vue-picker-host schedule-vue-time-host';
      hidden.parentNode.insertBefore(mount, hidden);

      const app = window.Vue.createApp({
        data() { return { value: initial || null }; },
        methods: {
          disabledMinutes,
          sync() {
            const start = Array.isArray(this.value) ? formatTime(this.value[0]) : '';
            const end = Array.isArray(this.value) ? formatTime(this.value[1]) : '';
            hidden.value = start && end ? `${start}-${end}` : '';
            emitInput(hidden);
          },
          restore(value) {
            const parsed = parseTimeRange(value);
            this.value = parsed || null;
          },
        },
        mounted() { if (this.value) this.sync(); },
        render() {
          const TimePicker = window.Vue.resolveComponent('el-time-picker');
          return window.Vue.h(TimePicker, {
            modelValue: this.value,
            'onUpdate:modelValue': value => { this.value = value; },
            isRange: true,
            rangeSeparator: '-',
            startPlaceholder: '开始',
            endPlaceholder: '结束',
            format: 'HH:mm',
            size: 'small',
            editable: false,
            clearable: true,
            disabledMinutes: this.disabledMinutes,
            onChange: this.sync,
          });
        },
      });
      useElementPlus(app);
      scheduleVms[i] = app.mount(mount);
      scheduleOpeners[i] = () => mount.querySelector('.el-date-editor')?.click();
    }

    window.posterTimeControls = window.posterTimeControls || {};
    window.posterTimeControls.openSchedule = i => scheduleOpeners[i]?.();
  }

  function restoreFromHidden() {
    meetingVm?.restore?.(meetingHidden.value);
    for (let i = 0; i < 4; i++) {
      scheduleVms[i]?.restore?.(document.getElementById(`s-time-${i}`)?.value || '');
    }
  }

  function installValidation() {
    form.addEventListener('submit', event => {
      if (!controlsState.ready) {
        event.preventDefault();
        event.stopImmediatePropagation();
        alert(controlsState.reason || '时间选择组件尚未就绪，请刷新页面重试。');
        return;
      }
      if (!meetingHidden.value) {
        event.preventDefault();
        event.stopImmediatePropagation();
        alert('请选择会议日期和会议时间。');
        window.posterTimeControls?.openMeeting?.();
        return;
      }

      for (let i = 0; i < 4; i++) {
        const time = document.getElementById(`s-time-${i}`)?.value.trim() || '';
        const content = document.getElementById(`s-content-${i}`)?.value.trim() || '';
        const speaker = document.getElementById(`s-speaker-${i}`)?.value.trim() || '';
        const chair = document.getElementById(`s-chair-${i}`)?.value.trim() || '';
        if ((content || speaker || chair) && !time) {
          event.preventDefault();
          event.stopImmediatePropagation();
          alert(`第 ${i + 1} 行日程请选择时间范围。`);
          window.posterTimeControls?.openSchedule?.(i);
          return;
        }
      }
    }, true);
  }

  ['chair-file', 'speaker1-file', 'speaker2-file', 'qrFile'].forEach(id => {
    document.getElementById(id)?.removeAttribute('required');
  });

  document.addEventListener('poster-draft-scalars-restored', () => {
    if (meetingVm) restoreFromHidden();
  });

  installValidation();
  ensureElementPlus()
    .then(() => {
      mountMeetingPicker();
      mountSchedulePickers();
      window.posterTimeControls = window.posterTimeControls || {};
      window.posterTimeControls.restoreFromHidden = restoreFromHidden;
      setControlsState(true, false, '时间选择组件已就绪');
    })
    .catch(err => {
      console.error(err);
      meetingHost.innerHTML = '<div class="time-component-error">时间选择组件加载失败，请刷新页面重试。</div>';
      setControlsState(false, true, '时间选择组件加载失败，请刷新页面重试。');
    });
})();
