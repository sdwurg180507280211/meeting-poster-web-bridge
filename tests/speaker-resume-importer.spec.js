const { test, expect } = require('@playwright/test');

test('speaker resume importer extracts names and current hospitals', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#importSpeakerZip')).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(window.posterSpeakerImporter))).toBe(true);

  const parsed = await page.evaluate(() => ({
    guo: window.posterSpeakerImporter.extractNameFromFilename('郭剑颖教授简介.pptx'),
    zhang: window.posterSpeakerImporter.extractNameFromFilename('13_专家介绍-张智健.pptx'),
    ma: window.posterSpeakerImporter.extractNameFromFilename('1_马宇洁简历模板.pptx'),
    hospital: window.posterSpeakerImporter.extractHospital([
      '曾先后工作于北京朝阳医院麻醉科',
      '现任北京大学国际医院麻醉科主任',
    ].join('\n')),
  }));

  expect(parsed).toEqual({
    guo: '郭剑颖',
    zhang: '张智健',
    ma: '马宇洁',
    hospital: '北京大学国际医院',
  });
});

test('speaker resume zip imports three PPTX resumes, crops avatars and creates QR', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => Boolean(window.posterSpeakerImporter && window.JSZip && window.qrcode))).toBe(true);

  const result = await page.evaluate(async () => {
    function portraitBytes(seed) {
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 800;
      const context = canvas.getContext('2d');
      context.fillStyle = '#f2f2f2';
      context.fillRect(0, 0, 600, 800);
      context.fillStyle = '#777';
      context.beginPath();
      context.arc(300, 245 + seed * 4, 105, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#999';
      context.fillRect(185, 365, 230, 300);
      return new Promise((resolve, reject) => {
        canvas.toBlob(async blob => {
          if (!blob) return reject(new Error('fixture portrait failed'));
          resolve(new Uint8Array(await blob.arrayBuffer()));
        }, 'image/png');
      });
    }

    async function makePptx(texts, seed) {
      const zip = new JSZip();
      const xml = `<root xmlns:a="urn:a">${texts.map(text => `<a:t>${text}</a:t>`).join('')}</root>`;
      zip.file('ppt/slides/slide1.xml', xml);
      zip.file('ppt/media/image1.png', await portraitBytes(seed));
      return zip.generateAsync({ type: 'uint8array' });
    }

    const outer = new JSZip();
    outer.file('简历汇总/郭剑颖教授简介.pptx', await makePptx([
      '郭剑颖 教授',
      '解放军总医院第四医学中心重症医学科副主任',
    ], 1));
    outer.file('简历汇总/高燕简介2026.pptx', await makePptx([
      '高 燕 主任医师、二级教授',
      '北京大学人民医院 感染科主任',
    ], 2));
    outer.file('简历汇总/13_专家介绍-张智健.pptx', await makePptx([
      '张智健简介',
      '解放军总医院第二医学中心呼吸与危重症医学科副主任',
    ], 3));
    outer.file('__MACOSX/简历汇总/._ignore.pptx', new Uint8Array([1, 2, 3]));
    const zipBlob = await outer.generateAsync({ type: 'blob' });
    const archive = new File([zipBlob], '简历汇总.zip', { type: 'application/zip' });

    const imported = await window.posterSpeakerImporter.importArchive(archive);
    const roles = ['chair', 'speaker1', 'speaker2'];
    const people = [];
    for (const role of roles) {
      const file = document.getElementById(`${role}-file`).files[0];
      const bitmap = await createImageBitmap(file);
      people.push({
        name: document.getElementById(`${role}-name`).value,
        hospital: document.getElementById(`${role}-hospital`).value,
        type: file.type,
        width: bitmap.width,
        height: bitmap.height,
        readout: document.getElementById(`${role}-crop-readout`)?.textContent || '',
      });
      bitmap.close?.();
    }
    const qr = document.getElementById('qrFile').files[0];
    const qrBitmap = await createImageBitmap(qr);
    const qrInfo = { type: qr.type, width: qrBitmap.width, height: qrBitmap.height };
    qrBitmap.close?.();

    return {
      total: imported.total,
      usable: imported.usable.length,
      selectedNames: imported.selected.map(item => item.name).sort(),
      people,
      qrInfo,
    };
  });

  expect(result.total).toBe(3);
  expect(result.usable).toBe(3);
  expect(result.selectedNames).toEqual(['张智健', '郭剑颖', '高燕'].sort());
  expect(result.people.map(person => person.name).sort()).toEqual(['张智健', '郭剑颖', '高燕'].sort());
  expect(result.people.map(person => person.hospital).sort()).toEqual([
    '北京大学人民医院',
    '解放军总医院第二医学中心',
    '解放军总医院第四医学中心',
  ].sort());
  for (const person of result.people) {
    expect(person.type).toBe('image/png');
    expect(person.width).toBe(1024);
    expect(person.height).toBe(1024);
    expect(person.readout).toContain('已自动裁剪');
  }
  expect(result.qrInfo).toEqual({ type: 'image/png', width: 1024, height: 1024 });
});
