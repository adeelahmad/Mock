package meet

import (
	"context"
	"time"
)

// FakeBot pretends to join (`mock bridge --fake-bot`): the app's Meet flow can be tested with no
// browser and no meeting. It goes launching → waiting → in the call, and leaves when told.
type FakeBot struct{ r BotRequest }

func NewFakeBot(r BotRequest) Bot { return &FakeBot{r: r} }

func (f *FakeBot) Start(context.Context) error {
	f.r.OnStatus(Launching, "")
	f.r.OnStatus(Waiting, "")
	time.AfterFunc(300*time.Millisecond, func() { f.r.OnStatus(InCall, "") })
	return nil
}
func (f *FakeBot) Play(string, float64) {}
func (f *FakeBot) Flush()               {}
func (f *FakeBot) Tile(Tile)            {}
func (f *FakeBot) Leave()               { f.r.OnStatus(Left, "") }
