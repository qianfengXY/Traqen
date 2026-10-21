import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.GetMapping;
@RestController
@RequestMapping("/records")
class Records {
 @GetMapping("/{id}")
 String read(){return "😀";}
}
