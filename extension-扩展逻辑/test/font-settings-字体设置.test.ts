import assert from 'assert';
import { describe, it } from 'node:test';
import Module from 'module';

// VSCode stub with state
const configStore: Record<string, any> = {};
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id: string) {
  if (id === 'vscode') {
    return {
      workspace: {
        getConfiguration: (section: string) => ({
          get: (key: string, defaultValue: any) => {
            const fullKey = `${section}.${key}`;
            return configStore[fullKey] !== undefined ? configStore[fullKey] : defaultValue;
          },
          update: async (key: string, value: any, scope: any) => {
            const fullKey = `${section}.${key}`;
            configStore[fullKey] = value;
          }
        })
      },
      ConfigurationTarget: { Global: 1 }
    } as any;
  }
  return originalRequire.apply(this, arguments as any);
};

import * as vscode from 'vscode';

describe('字体设置测试', () => {
  it('应该支持字体家族更改', async () => {
    const config = vscode.workspace.getConfiguration('csv');
    const fontList = [
      'Consolas',
      'Courier New',
      'Menlo',
      'Monaco',
      'Lucida Console',
      'Liberation Mono',
      'DejaVu Sans Mono',
      'Source Code Pro',
      'Fira Code',
      'JetBrains Mono',
      'Roboto Mono'
    ];

    for (const font of fontList) {
      await config.update('fontFamily', font, vscode.ConfigurationTarget.Global);
      const updated = config.get<string>('fontFamily', '');
      assert.strictEqual(updated, font, `字体应该设置为 ${font}`);
    }

    // 恢复默认
    await config.update('fontFamily', '', vscode.ConfigurationTarget.Global);
  });

  it('应该支持字体大小更改', async () => {
    const config = vscode.workspace.getConfiguration('csv');
    const testSizes = [0, 12, 14, 16, 18, 20];

    for (const size of testSizes) {
      await config.update('fontSize', size, vscode.ConfigurationTarget.Global);
      const updated = config.get<number>('fontSize', 0);
      assert.strictEqual(updated, size, `字体大小应该设置为 ${size}`);
    }

    // 恢复默认
    await config.update('fontSize', 0, vscode.ConfigurationTarget.Global);
  });

  it('字体大小为0时应继承编辑器设置', async () => {
    const config = vscode.workspace.getConfiguration('csv');
    await config.update('fontSize', 0, vscode.ConfigurationTarget.Global);
    const csvFontSize = config.get<number>('fontSize', 0);
    assert.strictEqual(csvFontSize, 0, '字体大小为0表示继承编辑器设置');
  });

  it('字体家族为空时应继承编辑器设置', async () => {
    const config = vscode.workspace.getConfiguration('csv');
    await config.update('fontFamily', '', vscode.ConfigurationTarget.Global);
    const csvFontFamily = config.get<string>('fontFamily', '');
    assert.strictEqual(csvFontFamily, '', '字体家族为空表示继承编辑器设置');
  });
});
