package orchestrator

import (
	"flag"
)

// UIComponentType defines how the frontend should render the parameter
type UIComponentType string

const (
	ComponentText     UIComponentType = "text"
	ComponentSlider   UIComponentType = "slider"
	ComponentDropdown UIComponentType = "dropdown"
	ComponentToggle   UIComponentType = "toggle"
	ComponentNumber   UIComponentType = "number"
)

// MediaParameter is the core programming interface for all media generation options
type MediaParameter interface {
	GetID() string
	GetLabel() string
	GetType() UIComponentType
	RegisterFlag(fs *flag.FlagSet)
	ToMap() map[string]interface{}
}

// ---------------------------------------------------------
// Parameter Implementations
// ---------------------------------------------------------

type SliderParam struct {
	ID           string
	Label        string
	Min          float64
	Max          float64
	Step         float64
	DefaultValue float64
	currentValue *float64
}

func (p *SliderParam) GetID() string            { return p.ID }
func (p *SliderParam) GetLabel() string          { return p.Label }
func (p *SliderParam) GetType() UIComponentType  { return ComponentSlider }
func (p *SliderParam) RegisterFlag(fs *flag.FlagSet) {
	p.currentValue = fs.Float64(p.ID, p.DefaultValue, p.Label)
}
func (p *SliderParam) ToMap() map[string]interface{} {
	return map[string]interface{}{
		"id": p.ID, "label": p.Label, "type": p.GetType(),
		"min": p.Min, "max": p.Max, "step": p.Step, "default": p.DefaultValue,
	}
}

type DropdownParam struct {
	ID           string
	Label        string
	Options      []string
	DefaultValue string
	currentValue *string
}

func (p *DropdownParam) GetID() string            { return p.ID }
func (p *DropdownParam) GetLabel() string          { return p.Label }
func (p *DropdownParam) GetType() UIComponentType  { return ComponentDropdown }
func (p *DropdownParam) RegisterFlag(fs *flag.FlagSet) {
	p.currentValue = fs.String(p.ID, p.DefaultValue, p.Label)
}
func (p *DropdownParam) ToMap() map[string]interface{} {
	return map[string]interface{}{
		"id": p.ID, "label": p.Label, "type": p.GetType(),
		"options": p.Options, "default": p.DefaultValue,
	}
}

type TextParam struct {
	ID           string
	Label        string
	DefaultValue string
	Multiline    bool
	Placeholder  string
	currentValue *string
}

func (p *TextParam) GetID() string            { return p.ID }
func (p *TextParam) GetLabel() string          { return p.Label }
func (p *TextParam) GetType() UIComponentType  { return ComponentText }
func (p *TextParam) RegisterFlag(fs *flag.FlagSet) {
	p.currentValue = fs.String(p.ID, p.DefaultValue, p.Label)
}
func (p *TextParam) ToMap() map[string]interface{} {
	return map[string]interface{}{
		"id": p.ID, "label": p.Label, "type": p.GetType(),
		"multiline": p.Multiline, "default": p.DefaultValue,
		"placeholder": p.Placeholder,
	}
}

type ToggleParam struct {
	ID           string
	Label        string
	DefaultValue bool
	currentValue *bool
}

func (p *ToggleParam) GetID() string            { return p.ID }
func (p *ToggleParam) GetLabel() string          { return p.Label }
func (p *ToggleParam) GetType() UIComponentType  { return ComponentToggle }
func (p *ToggleParam) RegisterFlag(fs *flag.FlagSet) {
	p.currentValue = fs.Bool(p.ID, p.DefaultValue, p.Label)
}
func (p *ToggleParam) ToMap() map[string]interface{} {
	return map[string]interface{}{
		"id": p.ID, "label": p.Label, "type": p.GetType(),
		"default": p.DefaultValue,
	}
}

type NumberParam struct {
	ID           string
	Label        string
	Min          int
	Max          int
	DefaultValue int
	currentValue *int
}

func (p *NumberParam) GetID() string            { return p.ID }
func (p *NumberParam) GetLabel() string          { return p.Label }
func (p *NumberParam) GetType() UIComponentType  { return ComponentNumber }
func (p *NumberParam) RegisterFlag(fs *flag.FlagSet) {
	p.currentValue = fs.Int(p.ID, p.DefaultValue, p.Label)
}
func (p *NumberParam) ToMap() map[string]interface{} {
	return map[string]interface{}{
		"id": p.ID, "label": p.Label, "type": p.GetType(),
		"min": p.Min, "max": p.Max, "default": p.DefaultValue,
	}
}

// ---------------------------------------------------------
// Engine Definitions
// ---------------------------------------------------------

type Engine struct {
	ID         string
	Name       string
	Desc       string
	Parameters []MediaParameter
}

func (e *Engine) ToMap() map[string]interface{} {
	var params []map[string]interface{}
	for _, p := range e.Parameters {
		params = append(params, p.ToMap())
	}
	return map[string]interface{}{
		"id": e.ID, "name": e.Name, "desc": e.Desc,
		"parameters": params,
	}
}

// MediaEngines stores all engines grouped by category (image, audio, video)
var MediaEngines = map[string][]Engine{
	"image": {
		{
			ID:   "doubao-seedream-5.0-lite",
			Name: "Doubao Seedream 5.0 Lite",
			Desc: "火山引擎最新旗舰图像模型，支持文生图与图生图，联网检索增强创作",
			Parameters: []MediaParameter{
				&TextParam{ID: "prompt", Label: "创意提示词", Multiline: true, Placeholder: "描述你想生成的画面…"},
				&DropdownParam{ID: "size", Label: "输出分辨率", Options: []string{"1024x1024", "2048x2048", "1024x1792", "1792x1024", "4096x4096"}, DefaultValue: "2048x2048"},
				&DropdownParam{ID: "aspect_ratio", Label: "画面比例", Options: []string{"1:1", "16:9", "9:16", "4:3", "3:4", "21:9"}, DefaultValue: "1:1"},
				&SliderParam{ID: "guidance_scale", Label: "提示词引导强度 (CFG)", Min: 1.0, Max: 20.0, Step: 0.5, DefaultValue: 7.0},
				&NumberParam{ID: "seed", Label: "随机种子 (-1 随机)", Min: -1, Max: 2147483647, DefaultValue: -1},
				&NumberParam{ID: "count", Label: "生成数量", Min: 1, Max: 15, DefaultValue: 1},
				&SliderParam{ID: "strength", Label: "参考图影响强度", Min: 0.0, Max: 1.0, Step: 0.05, DefaultValue: 0.7},
				&ToggleParam{ID: "watermark", Label: "AI 水印", DefaultValue: true},
				&ToggleParam{ID: "stream", Label: "流式输出 (实时进度)", DefaultValue: false},
			},
		},
		{
			ID:   "doubao-seedream-4.5",
			Name: "Doubao Seedream 4.5",
			Desc: "字节跳动稳定版图像多模态模型，整合文生图与图生图，性价比高",
			Parameters: []MediaParameter{
				&TextParam{ID: "prompt", Label: "创意提示词", Multiline: true, Placeholder: "描述你想生成的画面…"},
				&DropdownParam{ID: "size", Label: "输出分辨率", Options: []string{"1024x1024", "2048x2048", "4096x4096"}, DefaultValue: "2048x2048"},
				&DropdownParam{ID: "aspect_ratio", Label: "画面比例", Options: []string{"1:1", "16:9", "9:16", "4:3", "3:4"}, DefaultValue: "1:1"},
				&SliderParam{ID: "guidance_scale", Label: "提示词引导强度 (CFG)", Min: 1.0, Max: 20.0, Step: 0.5, DefaultValue: 7.0},
				&NumberParam{ID: "seed", Label: "随机种子 (-1 随机)", Min: -1, Max: 2147483647, DefaultValue: -1},
				&NumberParam{ID: "count", Label: "生成数量", Min: 1, Max: 15, DefaultValue: 1},
				&SliderParam{ID: "strength", Label: "参考图影响强度", Min: 0.0, Max: 1.0, Step: 0.05, DefaultValue: 0.7},
				&ToggleParam{ID: "watermark", Label: "AI 水印", DefaultValue: true},
			},
		},
	},
	"video": {
		{
			ID:   "doubao-seedance-1.5-pro",
			Name: "Doubao Seedance 1.5 Pro",
			Desc: "火山引擎旗舰视频生成模型，支持文生视频与图生视频，高保真运动生成",
			Parameters: []MediaParameter{
				&TextParam{ID: "prompt", Label: "视频描述", Multiline: true, Placeholder: "描述你想生成的视频场景、运动和镜头…"},
				&DropdownParam{ID: "mode", Label: "生成模式", Options: []string{"text2video", "image2video", "video2video"}, DefaultValue: "text2video"},
				&DropdownParam{ID: "resolution", Label: "分辨率", Options: []string{"1920x1080", "1080x1920", "1280x720", "720x1280", "1024x1024"}, DefaultValue: "1920x1080"},
				&DropdownParam{ID: "aspect_ratio", Label: "画面比例", Options: []string{"16:9", "9:16", "1:1", "4:3", "3:4", "21:9"}, DefaultValue: "16:9"},
				&DropdownParam{ID: "duration", Label: "视频时长", Options: []string{"3s", "5s", "10s", "15s", "30s", "60s"}, DefaultValue: "5s"},
				&DropdownParam{ID: "fps", Label: "帧率", Options: []string{"24", "30", "60"}, DefaultValue: "24"},
				&SliderParam{ID: "guidance_scale", Label: "提示词引导强度 (CFG)", Min: 1.0, Max: 20.0, Step: 0.5, DefaultValue: 7.0},
				&SliderParam{ID: "motion_strength", Label: "运动幅度", Min: 0.0, Max: 1.0, Step: 0.05, DefaultValue: 0.5},
				&DropdownParam{ID: "camera_motion", Label: "镜头运动", Options: []string{"none", "pan_left", "pan_right", "tilt_up", "tilt_down", "zoom_in", "zoom_out", "orbit", "tracking", "dolly", "crane"}, DefaultValue: "none"},
				&NumberParam{ID: "seed", Label: "随机种子 (-1 随机)", Min: -1, Max: 2147483647, DefaultValue: -1},
				&ToggleParam{ID: "loop", Label: "循环播放模式", DefaultValue: false},
				&ToggleParam{ID: "watermark", Label: "AI 水印", DefaultValue: true},
			},
		},
		{
			ID:   "doubao-seedance-1.0-lite",
			Name: "Doubao Seedance 1.0 Lite",
			Desc: "轻量级视频生成模型，快速出片，适用于短视频和社交媒体内容",
			Parameters: []MediaParameter{
				&TextParam{ID: "prompt", Label: "视频描述", Multiline: true, Placeholder: "描述你想生成的视频场景…"},
				&DropdownParam{ID: "mode", Label: "生成模式", Options: []string{"text2video", "image2video"}, DefaultValue: "text2video"},
				&DropdownParam{ID: "resolution", Label: "分辨率", Options: []string{"1280x720", "720x1280", "1024x1024"}, DefaultValue: "1280x720"},
				&DropdownParam{ID: "duration", Label: "视频时长", Options: []string{"3s", "5s", "10s"}, DefaultValue: "5s"},
				&DropdownParam{ID: "fps", Label: "帧率", Options: []string{"24", "30"}, DefaultValue: "24"},
				&SliderParam{ID: "guidance_scale", Label: "提示词引导强度 (CFG)", Min: 1.0, Max: 15.0, Step: 0.5, DefaultValue: 7.0},
				&SliderParam{ID: "motion_strength", Label: "运动幅度", Min: 0.0, Max: 1.0, Step: 0.05, DefaultValue: 0.5},
				&NumberParam{ID: "seed", Label: "随机种子 (-1 随机)", Min: -1, Max: 2147483647, DefaultValue: -1},
				&ToggleParam{ID: "watermark", Label: "AI 水印", DefaultValue: true},
			},
		},
	},
	"audio": {
		{
			ID:   "volcengine-tts-hd",
			Name: "火山引擎 HD 语音合成",
			Desc: "超高品质多音色语音合成，支持情感控制与 SSML 标记，适用于专业配音",
			Parameters: []MediaParameter{
				&TextParam{ID: "text", Label: "配音文案", Multiline: true, Placeholder: "输入需要合成的文字内容…"},
				&DropdownParam{ID: "voice_type", Label: "发音人", Options: []string{"温柔女声", "成熟男声", "活泼童声", "磁性男声", "新闻播报", "知性女声", "温暖长者", "英文男声", "英文女声"}, DefaultValue: "温柔女声"},
				&DropdownParam{ID: "language", Label: "语言", Options: []string{"zh-CN", "en-US", "ja-JP", "ko-KR", "fr-FR", "de-DE", "es-ES"}, DefaultValue: "zh-CN"},
				&DropdownParam{ID: "emotion", Label: "情感", Options: []string{"neutral", "happy", "sad", "angry", "surprised", "fearful", "whispering", "narration"}, DefaultValue: "neutral"},
				&SliderParam{ID: "speed", Label: "语速", Min: 0.25, Max: 4.0, Step: 0.05, DefaultValue: 1.0},
				&SliderParam{ID: "pitch", Label: "音调", Min: -12.0, Max: 12.0, Step: 0.5, DefaultValue: 0.0},
				&SliderParam{ID: "volume", Label: "音量", Min: 0.0, Max: 2.0, Step: 0.1, DefaultValue: 1.0},
				&DropdownParam{ID: "format", Label: "输出格式", Options: []string{"mp3", "wav", "ogg", "flac", "aac"}, DefaultValue: "mp3"},
				&DropdownParam{ID: "sample_rate", Label: "采样率", Options: []string{"16000", "22050", "44100", "48000"}, DefaultValue: "44100"},
				&ToggleParam{ID: "ssml", Label: "SSML 标记支持", DefaultValue: false},
			},
		},
		{
			ID:   "volcengine-music-gen",
			Name: "火山引擎 AI 音乐生成",
			Desc: "文本描述生成原创音乐，支持多种风格与乐器组合",
			Parameters: []MediaParameter{
				&TextParam{ID: "prompt", Label: "音乐描述", Multiline: true, Placeholder: "描述你想要的音乐风格、情绪、乐器…"},
				&DropdownParam{ID: "genre", Label: "音乐风格", Options: []string{"pop", "rock", "electronic", "jazz", "classical", "hip-hop", "ambient", "cinematic", "lo-fi", "folk", "r&b", "metal"}, DefaultValue: "cinematic"},
				&DropdownParam{ID: "mood", Label: "情绪氛围", Options: []string{"uplifting", "melancholic", "energetic", "calm", "dramatic", "mysterious", "romantic", "tense"}, DefaultValue: "uplifting"},
				&DropdownParam{ID: "duration", Label: "时长", Options: []string{"15s", "30s", "60s", "120s", "180s"}, DefaultValue: "30s"},
				&SliderParam{ID: "tempo", Label: "节奏 (BPM)", Min: 40.0, Max: 240.0, Step: 1.0, DefaultValue: 120.0},
				&DropdownParam{ID: "key", Label: "调性", Options: []string{"auto", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"}, DefaultValue: "auto"},
				&DropdownParam{ID: "format", Label: "输出格式", Options: []string{"mp3", "wav", "flac"}, DefaultValue: "wav"},
				&NumberParam{ID: "seed", Label: "随机种子 (-1 随机)", Min: -1, Max: 2147483647, DefaultValue: -1},
				&ToggleParam{ID: "instrumental", Label: "纯器乐（无人声）", DefaultValue: true},
			},
		},
		{
			ID:   "volcengine-sfx-gen",
			Name: "火山引擎 AI 音效生成",
			Desc: "文本描述生成高品质音效，适用于影视、游戏制作",
			Parameters: []MediaParameter{
				&TextParam{ID: "prompt", Label: "音效描述", Multiline: true, Placeholder: "描述你想要的音效，如：雨打在铁皮屋顶上…"},
				&DropdownParam{ID: "category", Label: "音效类别", Options: []string{"nature", "urban", "human", "mechanical", "sci-fi", "horror", "musical", "impact", "ambient", "footsteps", "weather", "animal"}, DefaultValue: "nature"},
				&DropdownParam{ID: "duration", Label: "时长", Options: []string{"1s", "3s", "5s", "10s", "30s"}, DefaultValue: "5s"},
				&DropdownParam{ID: "format", Label: "输出格式", Options: []string{"wav", "mp3", "ogg"}, DefaultValue: "wav"},
				&DropdownParam{ID: "sample_rate", Label: "采样率", Options: []string{"22050", "44100", "48000"}, DefaultValue: "44100"},
				&NumberParam{ID: "seed", Label: "随机种子 (-1 随机)", Min: -1, Max: 2147483647, DefaultValue: -1},
			},
		},
	},
}

// GetSchema returns the entire registry formatted for JSON API responses
func GetSchema() map[string][]map[string]interface{} {
	schema := make(map[string][]map[string]interface{})
	for category, engines := range MediaEngines {
		var serialized []map[string]interface{}
		for _, e := range engines {
			serialized = append(serialized, e.ToMap())
		}
		schema[category] = serialized
	}
	return schema
}
