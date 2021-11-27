namespace Arducam {
    const ARDUCHIP_TEST1 = 0x00;
    const ARDUCHIP_FIFO  = 0x04;  //FIFO and I2C control
    const FIFO_CLEAR_MASK = 0x01;
    const FIFO_START_MASK = 0x02;
    const ARDUCHIP_TRIG = 0x41;
    const CAP_DONE_MASK = 0x08;
    const FIFO_SIZE1	= 0x42  //Camera write FIFO size[7:0] for burst to read
    const FIFO_SIZE2	= 0x43  //Camera write FIFO size[15:8]
    const FIFO_SIZE3	= 0x44  //Camera write FIFO size[18:16]
    const MAX_FIFO_SIZE = 0x5FFFF
    const BURST_FIFO_READ = 0x3C

    let frame: Array<number> = [];

    function writeReg(addr: number, data: number) {
        pins.digitalWritePin(DigitalPin.P0, 0);
        pins.spiWrite(addr | 0x80);
        pins.spiWrite(data);
        pins.digitalWritePin(DigitalPin.P0, 1);
    }

    function readReg(addr: number) {
        pins.digitalWritePin(DigitalPin.P0, 0);
        pins.spiWrite(addr);
        let value = pins.spiWrite(0x00)
        pins.digitalWritePin(DigitalPin.P0, 1); 
        
        return value;

    }
    interface reg {
        addr: number,
        value: number
    }
    
    function wrSensorReg8_8(id: number, data: number) {
        let buffer = pins.createBuffer(2)
        buffer.setUint8(0, id)
        buffer.setUint8(1, data)
        pins.i2cWriteBuffer(0x30, buffer)
    }

    function wrSensorRegs8_8(regs: SensorReg[]) {
        regs.forEach(function (reg: SensorReg, index: number) {
          wrSensorReg8_8(reg.addr, reg.value)
        })
    } 

    let brightness_map: Array<number> = [];

    function flushBuffer() {
        let length = ((readReg(FIFO_SIZE3) << 16) | (readReg(FIFO_SIZE2) << 8) | readReg(FIFO_SIZE1)) & 0x07fffff;
        while(length--){
            let buf1 = pins.createBuffer(1)
            buf1.setUint8(0, pins.spiWrite(0))
        }
    }

    function readFrame() {
        // get length
        let length = ((readReg(FIFO_SIZE3) << 16) | (readReg(FIFO_SIZE2) << 8) | readReg(FIFO_SIZE1)) & 0x07fffff;
        // serial.writeLine(`fifo length=${length} MAX_FIFO_SIZE=${MAX_FIFO_SIZE}`);
        if (length >= MAX_FIFO_SIZE || length == 0) {
            return
        }
        pins.digitalWritePin(DigitalPin.P0, 0)
        pins.spiWrite(BURST_FIFO_READ)

        let line_average
        for(let line=0; line<5; line++){
            line_average = [0, 0, 0, 0, 0]
            for(let y=0; y<5; y++){
                for(let x=0; x<48; x++){
                    let buf1 = pins.createBuffer(1)
                    let buf2 = pins.createBuffer(1)
                    buf1.setUint8(0, pins.spiWrite(0))
                    buf2.setUint8(0, pins.spiWrite(0))
                    if(x < 45){
                        line_average[Math.floor(x / 9)] += convertRGB565toBrightness(buf1[0] << 8 | buf2[0])
                    }
                }
            }
            for(let cnt=0; cnt<5; cnt++){
                brightness_map[line*5+cnt] = line_average[cnt] / 45
            }

        }
        pins.digitalWritePin(DigitalPin.P0, 1)

        return
    }

    /**
     * capture
     */
    //% blockId=brightness_map block="BrightnessMap"
    export function brightnessMap()
    {
        return brightness_map
    }

    /**
     *  RGB565から輝度データへの変換
     * @param rgb565 
     * @returns 
     */
    function convertRGB565toBrightness(rgb565: number){
        let r, g, b
        r = ((rgb565 >> 8) & 0xf8) / 256
        g = ((rgb565 >> 3) & 0xfc) / 256
        b = ((rgb565 << 3) & 0xf8) / 256

        let brightness = 0.299 * r + 0.587 * g + 0.114 * b
        return brightness
    }

    export enum IMAGE_FORMAT {
        BMP = 0x00,
        JPEG = 0x01,
        RAW = 0x02,
    }

    export enum IMAGE_RESOLUTION {
        OV2640_320x240 = 2, 
        OV2640_640x480 = 4	, 
        OV2640_800x600 = 5	, 
        OV2640_1600x1200 = 8,
    }

    /**
     * Init Camera First
     * @param pin share pin
     * @param format image fromat
     */
    //% blockId=camera_init block="Init Camera with format $format and resolution $reso"
    export function initCamera(format: IMAGE_FORMAT, reso: IMAGE_RESOLUTION) {
        pins.digitalWritePin(DigitalPin.P0, 1);
        writeReg(0x07, 0x80);
        basic.pause(100);
        writeReg(0x07, 0x00);
        basic.pause(100);

        while(true) {
            writeReg(ARDUCHIP_TEST1, 0x55);
            let value = readReg(ARDUCHIP_TEST1);
            if (value != 0x55) {
                basic.showIcon(IconNames.Sad)
                basic.pause(1000); 
                basic.clearScreen();
                continue;
            } else {
                basic.showIcon(IconNames.Happy)
                break;
            }
        }

        wrSensorReg8_8(0xff, 0x01)
        basic.pause(100);
        wrSensorReg8_8(0xff, 0x01);
        wrSensorReg8_8(0x12, 0x80);
        basic.pause(10);
        wrSensorRegs8_8(OV2640_JPEG_INIT);

        // 以下は以下サイトを参考に、sccb.cで生成したもの。
        // https://www.mgo-tec.com/blog-entry-sccb-dma-i2s-esp32-ov2640.html/2

        wrSensorReg8_8(0xff, 0x01);  // SENSOR REG
        basic.pause(5);
        wrSensorReg8_8(0x12, 0x20);  // CIF
        wrSensorReg8_8(0x17, 0x11);  // HREFST
        wrSensorReg8_8(0x18, 0x43);  // HREFEND
        wrSensorReg8_8(0x19, 0x00);
        wrSensorReg8_8(0x1a, 0x4a);  // VEND = 74
        wrSensorReg8_8(0x32, 0x89);  // REG32 10 001 001 = 1/1
        wrSensorReg8_8(0x03, 0x0a);  // COM1 00 00 10 10
        wrSensorReg8_8(0x11, 0x01);  // CLKRC
        basic.pause(5);
        wrSensorReg8_8(0xff, 0x00);  // DSP REG
        basic.pause(5);
        wrSensorReg8_8(0xe0, 0x04);
        basic.pause(5);
        wrSensorReg8_8(0xc0, 0x32);  // HSIZE8 = 00110010 000 = 400
        wrSensorReg8_8(0xc1, 0x25);  // VSIZE8 = 00100101 000 = 296
        wrSensorReg8_8(0x8c, 0x00);  // SIZEL
        wrSensorReg8_8(0x86, 0x3d);  // CTRL2
        wrSensorReg8_8(0x50, 0x80);  // CTRL1
        wrSensorReg8_8(0x51, 0x64);  // HSIZE = 100, *4=400
        wrSensorReg8_8(0x52, 0x4a);  // VSIZE = 74,  *4=296
        wrSensorReg8_8(0x53, 0x00);  // XOFFSET
        wrSensorReg8_8(0x54, 0x00);  // YOFFSET
        wrSensorReg8_8(0x55, 0x00);
        wrSensorReg8_8(0x57, 0x00);
        wrSensorReg8_8(0x5a, 0x0c);  // OUTW 12*4 = 48
        wrSensorReg8_8(0x5b, 0x09);  // OUTH 9*4  = 36
        wrSensorReg8_8(0x5c, 0x00);
        wrSensorReg8_8(0xd3, 0x82);
        wrSensorReg8_8(0xe0, 0x00);
        wrSensorReg8_8(0x05, 0x00);
        basic.pause(10);

    }

    /**
     * capture
     */
    //% blockId=camera_capture block="capture"
    export function capture() {
        writeReg(ARDUCHIP_FIFO, FIFO_CLEAR_MASK);
        writeReg(ARDUCHIP_FIFO, FIFO_START_MASK);

        while(!(readReg(ARDUCHIP_TRIG) & CAP_DONE_MASK)) {
            // wait capture finished
        }
        readFrame();
    }


    //% blockId=camera_image block="image"
    export function image(): number {
        return frame[0];
    }
        
}