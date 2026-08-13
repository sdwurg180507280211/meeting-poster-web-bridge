(() => {
  'use strict';

  const TABLE = 'poster_project_text_layouts';
  const CLIENT_WAIT_TIMEOUT_MS = 12000;
  const CLIENT_WAIT_STEP_MS = 80;
  let clientPromise = null;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function baseLayout(project) {
    const result = {};
    for (const item of project?.textItems || []) {
      result[item.id] = {
        x: Number(item.x || 0),
        y: Number(item.y || 0),
        scale: Number(item.scale || 1),
      };
    }
    return result;
  }

  function normalizeEntry(value, fallback) {
    const source = isObject(value) ? value : {};
    const x = Number(source.x);
    const y = Number(source.y);
    const scale = Number(source.scale);
    return {
      x: Number.isFinite(x) ? x : fallback.x,
      y: Number.isFinite(y) ? y : fallback.y,
      scale: Number.isFinite(scale) && scale > 0 ? scale : fallback.scale,
    };
  }

  function normalizeLayout(project, value) {
    const fallback = baseLayout(project);
    const source = isObject(value) ? value : {};
    const result = {};
    for (const [id, base] of Object.entries(fallback)) {
      result[id] = normalizeEntry(source[id], base);
    }
    return result;
  }

  async function resolveClient() {
    if (clientPromise) return clientPromise;
    clientPromise = (async () => {
      const deadline = Date.now() + CLIENT_WAIT_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const client = window.POSTER_APP_CLIENT;
        if (client?.auth?.getSession) {
          const { data, error } = await client.auth.getSession();
          if (!error && data?.session?.user?.id) return client;
        }
        await sleep(CLIENT_WAIT_STEP_MS);
      }
      throw new Error('云端登录尚未就绪，无法读取文字布局');
    })();
    try {
      return await clientPromise;
    } catch (error) {
      clientPromise = null;
      throw error;
    }
  }

  function rowFor(project, layout) {
    if (!project?.id || !project?.textLayoutProfile) {
      throw new Error('当前项目缺少文字布局标识');
    }
    return {
      project_id: project.id,
      profile_id: project.textLayoutProfile,
      layout: normalizeLayout(project, layout),
      updated_at: new Date().toISOString(),
    };
  }

  async function save(project, layout) {
    const client = await resolveClient();
    const row = rowFor(project, layout);
    const { error } = await client
      .from(TABLE)
      .upsert(row, { onConflict: 'project_id,profile_id' });
    if (error) throw error;
    return clone(row.layout);
  }

  async function load(project) {
    const client = await resolveClient();
    if (!project?.id || !project?.textLayoutProfile) {
      throw new Error('当前项目缺少文字布局标识');
    }

    const { data, error } = await client
      .from(TABLE)
      .select('layout')
      .eq('project_id', project.id)
      .eq('profile_id', project.textLayoutProfile)
      .maybeSingle();
    if (error) throw error;

    if (!data) {
      return save(project, baseLayout(project));
    }

    const normalized = normalizeLayout(project, data.layout);
    if (JSON.stringify(normalized) !== JSON.stringify(data.layout || {})) {
      await save(project, normalized);
    }
    return clone(normalized);
  }

  window.posterTextLayoutStore = Object.freeze({
    table: TABLE,
    baseLayout,
    normalizeLayout,
    load,
    save,
  });
})();
