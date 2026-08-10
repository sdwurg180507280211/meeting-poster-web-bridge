(() => {
  const form = document.getElementById('posterForm');
  const meetingHidden = document.getElementById('meetingTime');
  const meetingHost = document.getElementById('meetingTimePicker');
  if (!form || !meetingHidden || !meetingHost) return;

  const ELEMENT_VERSION = '2.14.3';
  const scheduleOpeners = [];
  const scheduleVms = [];
  let meetingVm = null;

  function emitInput(el) {
    el?.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function loadStyle(id, href) {
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }

  function loadScript(id, src) {
    return new Promise((resolve, reject) => {
      const existing = document.getElementById(id);
      if (existing) {
        if (existing.dataset.loaded === '1') resolve();
        else existing.addEventListener('load', resolve, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.id = id;
      script.src = src;
      script.onload = () => { script.dataset.loaded = '1'; resolve(); };
      script.onerror = () => reject(new Error(`加载组件失败：${src}`));
      document.head.appendChild(script);
    });
  }

  async function ensureElementPlus() {
    loadStyle('element-plus-css', `https://cdn.jsdelivr.net/npm/element-plus@${ELEMENT_VERSION}/dist/index.css`);
    if (!window.Vue) {
      await loadScript('vue3-cdn', 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.global.prod.js');
    }
    if (!window.ElementPlus) {
      await loadScript('element-plus-cdn', `https://cdn.jsdelivr.net/npm/element-plus@${ELEMENT_VERSION}/dist/index.full.min.js`);
    }
    if (!window.ElementPlusLocaleZhCn) {
      try {
        await loadScript('element-plus-zh-cn', `https://cdn.jsdelivr.net/npm/element-plus@${ELEMENT_VERSION}/dist/locale/zh-cn`);
      } catch (err) {
        console.warn('Element Plus 中文语言包加载失败，将使用默认语言。', err);
      }
    }
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

    const app = Vue.createApp({
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
      template: `
        <div class="element-meeting-picker">
          <el-date-picker
            v-model="date"
            type="date"
            format="YYYY年M月D日"
            placeholder="选择会议日期"
            size="small"
            :editable="false"
            :clearable="false"
            @change="sync"
          ></el-date-picker>
          <el-time-picker
            v-model="range"
            is-range
            range-separator="-"
            start-placeholder="开始时间"
            end-placeholder="结束时间"
            format="HH:mm"
            size="small"
            :editable="false"
            :clearable="false"
            :disabled-minutes="disabledMinutes"
            @change="sync"
          ></el-time-picker>
        </div>`
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

      const app = Vue.createApp({
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
        template: `
          <el-time-picker
            v-model="value"
            is-range
            range-separator="-"
            start-placeholder="开始"
            end-placeholder="结束"
            format="HH:mm"
            size="small"
            :editable="false"
            :clearable="true"
            :disabled-minutes="disabledMinutes"
            @change="sync"
          ></el-time-picker>`
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

  ensureElementPlus()
    .then(() => {
      mountMeetingPicker();
      mountSchedulePickers();
      installValidation();
      window.posterTimeControls = window.posterTimeControls || {};
      window.posterTimeControls.restoreFromHidden = restoreFromHidden;
    })
    .catch(err => {
      console.error(err);
      meetingHost.innerHTML = '<div class="time-component-error">时间选择组件加载失败，请刷新页面重试。</div>';
    });
})();
