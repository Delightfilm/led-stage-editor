const mustReplace = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`ESP32 LCD compat: ${label} anchor not found`)
  return source.replace(from, to)
}

export function managementEsp32LcdCompatPlugin() {
  return {
    name: 'management-esp32-lcd-compat',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/managementEsp32Firmware.js')) return null
      if (code.includes('ESP32_LCD_SELF_CONTAINED_V1')) return { code, map: null }

      let out = code

      const lcdDriver = `#include <Arduino.h>

class Pcf8574Lcd : public Print {
public:
  using Print::write;

  void init() {
    ready_ = false;
    const uint8_t preferred[] = {0x27, 0x3F};
    for (uint8_t i = 0; i < sizeof(preferred); i++) {
      if (probe(preferred[i])) {
        address_ = preferred[i];
        ready_ = true;
        break;
      }
    }
    if (!ready_) {
      for (uint8_t address = 0x20; address <= 0x27; address++) {
        if (probe(address)) {
          address_ = address;
          ready_ = true;
          break;
        }
      }
    }
    if (!ready_) {
      for (uint8_t address = 0x38; address <= 0x3F; address++) {
        if (probe(address)) {
          address_ = address;
          ready_ = true;
          break;
        }
      }
    }
    if (!ready_) return;

    delay(50);
    expanderWrite(0);
    delay(1000);
    write4bits(0x30);
    delayMicroseconds(4500);
    write4bits(0x30);
    delayMicroseconds(4500);
    write4bits(0x30);
    delayMicroseconds(150);
    write4bits(0x20);

    command(0x28);
    command(0x08);
    clear();
    command(0x06);
    command(0x0C);
  }

  void backlight() {
    backlightMask_ = 0x08;
    if (ready_) expanderWrite(0);
  }

  void clear() {
    if (!ready_) return;
    command(0x01);
    delayMicroseconds(2000);
  }

  void setCursor(uint8_t col, uint8_t row) {
    if (!ready_) return;
    const uint8_t rowOffset = row ? 0x40 : 0x00;
    command(0x80 | (col + rowOffset));
  }

  bool isReady() const { return ready_; }
  uint8_t getAddress() const { return address_; }

  size_t write(uint8_t value) override {
    if (!ready_) return 0;
    send(value, 0x01);
    return 1;
  }

private:
  static const uint8_t EN = 0x04;
  uint8_t address_ = 0;
  uint8_t backlightMask_ = 0x08;
  bool ready_ = false;

  bool probe(uint8_t address) {
    Wire.beginTransmission(address);
    return Wire.endTransmission() == 0;
  }

  void expanderWrite(uint8_t value) {
    if (!ready_) return;
    Wire.beginTransmission(address_);
    Wire.write(value | backlightMask_);
    Wire.endTransmission();
  }

  void pulseEnable(uint8_t value) {
    expanderWrite(value | EN);
    delayMicroseconds(1);
    expanderWrite(value & ~EN);
    delayMicroseconds(50);
  }

  void write4bits(uint8_t value) {
    expanderWrite(value);
    pulseEnable(value);
  }

  void send(uint8_t value, uint8_t mode) {
    write4bits((value & 0xF0) | mode);
    write4bits(((value << 4) & 0xF0) | mode);
  }

  void command(uint8_t value) {
    send(value, 0x00);
  }
};`

      out = mustReplace(
        out,
        '#include <LiquidCrystal_I2C.h>',
        lcdDriver,
        'remove AVR-oriented LiquidCrystal_I2C dependency',
      )

      out = mustReplace(
        out,
        'LiquidCrystal_I2C lcd(0x27, 16, 2);',
        'Pcf8574Lcd lcd;',
        'LCD object',
      )

      out = mustReplace(
        out,
        ' * Library required: LiquidCrystal_I2C.',
        ' * LCD: built-in PCF8574 1602 driver; auto-detects 0x27/0x3F and PCF8574 ranges.',
        'MASTER LCD documentation',
      )

      out = mustReplace(
        out,
        '  lcd.init();\n  lcd.backlight();\n  lcd.clear();',
        [
          '  lcd.init();',
          '  lcd.backlight();',
          '  lcd.clear();',
          '  if (lcd.isReady()) {',
          '    Serial.print("LCD_I2C_FOUND 0x");',
          '    Serial.println(lcd.getAddress(), HEX);',
          '    lcd.setCursor(0,0);',
          '    lcd.print("ESP32 MASTER");',
          '    lcd.setCursor(0,1);',
          '    lcd.print("LCD OK 0x");',
          '    lcd.print(lcd.getAddress(), HEX);',
          '    delay(700);',
          '    lcd.clear();',
          '  } else {',
          '    Serial.println("LCD_I2C_NOT_FOUND SDA=21 SCL=22");',
          '  }',
        ].join('\n'),
        'LCD startup diagnostics',
      )

      out += '\n// ESP32_LCD_SELF_CONTAINED_V1\n'
      return { code: out, map: null }
    },
  }
}
