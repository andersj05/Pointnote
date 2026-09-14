import type {
  Annotation,
  ImagePoint,
  ScreenshotImage,
  ScreenshotMark,
  ScreenshotPatch,
} from './types';

export const isLocalPng = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 16000000 &&
  /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value);

function point(value: ImagePoint): ImagePoint {
  if (
    !value ||
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y) ||
    value.x < 0 ||
    value.x > 1 ||
    value.y < 0 ||
    value.y > 1
  )
    throw new Error('A screenshot mark falls outside the captured image.');
  return { x: value.x, y: value.y };
}
export function validateMarks(value: unknown): ScreenshotMark[] {
  if (!Array.isArray(value) || value.length > 40)
    throw new Error('Use up to 40 marks per image.');
  return value.map((mark) => {
    if (mark?.kind === 'arrow')
      return { kind: 'arrow', from: point(mark.from), to: point(mark.to) };
    if (
      mark?.kind === 'callout' &&
      typeof mark.text === 'string' &&
      mark.text.length <= 240
    )
      return { kind: 'callout', at: point(mark.at), text: mark.text };
    throw new Error('Screenshot markup is invalid.');
  });
}
export function screenshotImages(note: Annotation): ScreenshotImage[] {
  return note.screenshot.status === 'available'
    ? [
        note.screenshot,
        ...(note.screenshot.crops || []).filter(
          (crop): crop is Extract<typeof crop, { status: 'available' }> =>
            crop.status === 'available',
        ),
      ]
    : [];
}
export function applyScreenshotPatch(
  note: Annotation,
  patch: ScreenshotPatch,
): Annotation {
  const screenshot = note.screenshot;
  if (
    screenshot.status !== 'available' ||
    !patch ||
    patch.capturePath !== screenshot.path ||
    patch.revision !== (screenshot.revision || 0)
  )
    throw new Error(
      'This screenshot changed in another tab. Reopen it to edit the latest version.',
    );
  if (
    !Array.isArray(patch.edits) ||
    !patch.edits.length ||
    patch.edits.length > 13 ||
    new Set(patch.edits.map((e) => e.imagePath)).size !== patch.edits.length
  )
    throw new Error('Screenshot edits are invalid.');
  const images = screenshotImages(note);
  const changed = new Map<string, ScreenshotImage>();
  for (const edit of patch.edits) {
    const original = images.find((image) => image.path === edit.imagePath);
    if (!original?.dataUrl)
      throw new Error('The original screenshot is unavailable.');
    const marks = validateMarks(edit.marks);
    if (marks.length && !isLocalPng(edit.renderedDataUrl))
      throw new Error('The marked screenshot is invalid or too large.');
    const { marks: previousMarks, marked: previousMarked, ...image } = original;
    void previousMarks;
    void previousMarked;
    changed.set(edit.imagePath, {
      ...image,
      ...(marks.length
        ? {
            marks,
            marked: {
              path: image.path.replace(/\.png$/, '-marked.png'),
              dataUrl: edit.renderedDataUrl!,
            },
          }
        : {}),
    });
  }
  const result: Annotation = {
    ...note,
    updatedAt: new Date().toISOString(),
    screenshot: {
      ...screenshot,
      ...changed.get(screenshot.path),
      // Explicitly remove cleared markup from the spread of the old image.
      ...(changed.has(screenshot.path)
        ? {
            marks: changed.get(screenshot.path)!.marks,
            marked: changed.get(screenshot.path)!.marked,
          }
        : {}),
      revision: (screenshot.revision || 0) + 1,
      ...(screenshot.crops
        ? {
            crops: screenshot.crops.map((crop) =>
              crop.status === 'available' && changed.has(crop.path)
                ? {
                    ...crop,
                    ...changed.get(crop.path),
                    marks: changed.get(crop.path)!.marks,
                    marked: changed.get(crop.path)!.marked,
                  }
                : crop,
            ),
          }
        : {}),
    },
  };
  if (JSON.stringify(result).length > 16000000)
    throw new Error(
      'These edits exceed this note’s image limit. Remove some marks or edit fewer close-ups.',
    );
  return result;
}
